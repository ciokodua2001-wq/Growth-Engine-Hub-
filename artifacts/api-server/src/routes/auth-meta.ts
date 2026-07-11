import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { metaConnectionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireUserId, loadOwnedProject } from "../lib/authz.js";
import { encryptToken, signState, verifyState } from "../lib/tokenCrypto.js";

const router: IRouter = Router();

const META_APP_ID = process.env.META_APP_ID ?? "";
const META_APP_SECRET = process.env.META_APP_SECRET ?? "";
const REDIRECT_URI = "https://usegrowthforge.com/api/auth/meta/callback";
const SCOPES = [
  "pages_manage_posts",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
].join(",");

/**
 * GET /auth/meta/start?projectId=<id>
 * Initiates Facebook OAuth. Verifies the caller owns the project before
 * redirecting. The projectId and userId are encoded in a HMAC-signed state
 * param so the callback can verify ownership without trusting client input.
 */
router.get("/auth/meta/start", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const rawId = req.query.projectId as string;
  const projectId = parseInt(rawId, 10);
  if (isNaN(projectId)) {
    res.status(400).json({ error: "projectId must be an integer" });
    return;
  }

  // Verify ownership before starting the flow
  const project = await loadOwnedProject(userId, projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  if (!META_APP_ID) {
    res.status(503).json({ error: "Meta app not configured" });
    return;
  }

  // Sign the state so the callback can verify it hasn't been tampered with
  const payload = JSON.stringify({ projectId, userId, exp: Date.now() + 10 * 60 * 1000 });
  const state = signState(Buffer.from(payload).toString("base64url"));

  const url = new URL("https://www.facebook.com/v20.0/dialog/oauth");
  url.searchParams.set("client_id", META_APP_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);

  res.redirect(url.toString());
});

/**
 * GET /auth/meta/callback
 * Exchanges the authorization code for a long-lived Page access token,
 * fetches the linked Page and Instagram Business Account, encrypts the
 * token, and stores the connection in `meta_connections`.
 *
 * Security: verifies HMAC state signature and that the authenticated
 * Clerk user matches the userId embedded in the state.
 */
router.get("/auth/meta/callback", async (req, res): Promise<void> => {
  const { code, state, error: oauthError } = req.query as Record<string, string>;

  if (oauthError) {
    req.log.warn({ oauthError }, "Meta OAuth denied by user");
    res.redirect("/dashboard?meta_error=denied");
    return;
  }

  if (!code || !state) {
    res.redirect("/dashboard?meta_error=missing_params");
    return;
  }

  // 1. Verify the signed state (prevents CSRF and tampered projectId/userId)
  let projectId: number;
  let stateUserId: string;
  try {
    const payload = verifyState(state);
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    projectId = parseInt(decoded.projectId, 10);
    stateUserId = decoded.userId as string;
    if (isNaN(projectId) || !stateUserId) throw new Error("invalid state fields");
    if (decoded.exp < Date.now()) throw new Error("state expired");
  } catch (err) {
    req.log.warn({ err }, "Meta OAuth state invalid");
    res.redirect("/dashboard?meta_error=invalid_state");
    return;
  }

  // 2. Verify the currently-authenticated user matches the state's userId
  const callbackUserId = getAuth(req)?.userId;
  if (!callbackUserId || callbackUserId !== stateUserId) {
    req.log.warn({ callbackUserId, stateUserId }, "Meta OAuth user mismatch");
    res.redirect("/dashboard?meta_error=user_mismatch");
    return;
  }

  // 3. Re-verify project ownership (the state was signed, but double-check)
  const project = await loadOwnedProject(callbackUserId, projectId);
  if (!project) {
    req.log.warn({ callbackUserId, projectId }, "Meta OAuth project not owned");
    res.redirect("/dashboard?meta_error=not_authorized");
    return;
  }

  try {
    // 4. Exchange code for short-lived user access token
    const tokenUrl = new URL("https://graph.facebook.com/v20.0/oauth/access_token");
    tokenUrl.searchParams.set("client_id", META_APP_ID);
    tokenUrl.searchParams.set("client_secret", META_APP_SECRET);
    tokenUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    tokenUrl.searchParams.set("code", code);

    const tokenRes = await fetch(tokenUrl.toString());
    const tokenData = await tokenRes.json() as { access_token?: string; error?: { message: string } };

    if (!tokenData.access_token) {
      req.log.error({ tokenData }, "Meta token exchange failed");
      res.redirect("/dashboard?meta_error=token_exchange");
      return;
    }

    const userToken = tokenData.access_token;

    // 5. Exchange for long-lived user access token (60 days)
    const llUrl = new URL("https://graph.facebook.com/v20.0/oauth/access_token");
    llUrl.searchParams.set("grant_type", "fb_exchange_token");
    llUrl.searchParams.set("client_id", META_APP_ID);
    llUrl.searchParams.set("client_secret", META_APP_SECRET);
    llUrl.searchParams.set("fb_exchange_token", userToken);

    const llRes = await fetch(llUrl.toString());
    const llData = await llRes.json() as { access_token?: string };
    const longLivedToken = llData.access_token ?? userToken;

    // 6. Get Pages — each has its own never-expiring Page access token
    const pagesUrl = new URL("https://graph.facebook.com/v20.0/me/accounts");
    pagesUrl.searchParams.set("access_token", longLivedToken);
    pagesUrl.searchParams.set("fields", "id,name,access_token");

    const pagesRes = await fetch(pagesUrl.toString());
    const pagesData = await pagesRes.json() as {
      data?: Array<{ id: string; name: string; access_token: string }>;
    };

    const pages = pagesData.data ?? [];
    if (pages.length === 0) {
      req.log.warn({ projectId }, "No Facebook Pages found for user");
      res.redirect("/dashboard?meta_error=no_pages");
      return;
    }

    // Use the first page (page-picker follow-up tracked as task #6)
    const page = pages[0];

    // 7. Look for a linked Instagram Business Account
    const igUrl = new URL(`https://graph.facebook.com/v20.0/${page.id}`);
    igUrl.searchParams.set("fields", "instagram_business_account");
    igUrl.searchParams.set("access_token", page.access_token);

    const igRes = await fetch(igUrl.toString());
    const igData = await igRes.json() as {
      instagram_business_account?: { id: string };
    };

    const instagramAccountId = igData.instagram_business_account?.id ?? null;

    // 8. Encrypt the page access token before storing
    const encryptedToken = encryptToken(page.access_token);

    // 9. Upsert the connection row
    await db
      .insert(metaConnectionsTable)
      .values({
        projectId,
        pageId: page.id,
        pageName: page.name,
        pageAccessToken: encryptedToken,
        instagramAccountId,
        connectedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: metaConnectionsTable.projectId,
        set: {
          pageId: page.id,
          pageName: page.name,
          pageAccessToken: encryptedToken,
          instagramAccountId,
          connectedAt: new Date(),
        },
      });

    req.log.info({ projectId, pageId: page.id }, "Meta account connected");
    res.redirect(`/dashboard?meta_connected=1&projectId=${projectId}`);
  } catch (err) {
    req.log.error({ err }, "Meta OAuth callback error");
    res.redirect("/dashboard?meta_error=server_error");
  }
});

export default router;
