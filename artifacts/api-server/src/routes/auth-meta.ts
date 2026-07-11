import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { metaConnectionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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
 * Initiates Facebook OAuth. The projectId is encoded in the `state` param
 * so the callback can associate the token with the correct project.
 */
router.get("/auth/meta/start", (req, res): void => {
  const userId = getAuth(req)?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const projectId = req.query.projectId as string;
  if (!projectId || isNaN(parseInt(projectId, 10))) {
    res.status(400).json({ error: "projectId is required" });
    return;
  }

  if (!META_APP_ID) {
    res.status(503).json({ error: "Meta app not configured" });
    return;
  }

  const state = Buffer.from(JSON.stringify({ projectId, userId })).toString("base64url");

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
 * fetches the linked Page and Instagram Business Account, then stores
 * the connection in `meta_connections` and redirects back to the dashboard.
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

  let projectId: number;
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf-8"));
    projectId = parseInt(decoded.projectId, 10);
    if (isNaN(projectId)) throw new Error("invalid projectId");
  } catch {
    res.redirect("/dashboard?meta_error=invalid_state");
    return;
  }

  try {
    // 1. Exchange code for short-lived user access token
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

    // 2. Exchange for long-lived user access token
    const llUrl = new URL("https://graph.facebook.com/v20.0/oauth/access_token");
    llUrl.searchParams.set("grant_type", "fb_exchange_token");
    llUrl.searchParams.set("client_id", META_APP_ID);
    llUrl.searchParams.set("client_secret", META_APP_SECRET);
    llUrl.searchParams.set("fb_exchange_token", userToken);

    const llRes = await fetch(llUrl.toString());
    const llData = await llRes.json() as { access_token?: string };
    const longLivedToken = llData.access_token ?? userToken;

    // 3. Get the user's Pages and their permanent Page access tokens
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

    // Use the first page (users can disconnect and reconnect to choose a different page)
    const page = pages[0];

    // 4. Look for a linked Instagram Business Account
    const igUrl = new URL(`https://graph.facebook.com/v20.0/${page.id}`);
    igUrl.searchParams.set("fields", "instagram_business_account");
    igUrl.searchParams.set("access_token", page.access_token);

    const igRes = await fetch(igUrl.toString());
    const igData = await igRes.json() as {
      instagram_business_account?: { id: string };
    };

    const instagramAccountId = igData.instagram_business_account?.id ?? null;

    // 5. Upsert the connection row
    await db
      .insert(metaConnectionsTable)
      .values({
        projectId,
        pageId: page.id,
        pageName: page.name,
        pageAccessToken: page.access_token,
        instagramAccountId,
        connectedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: metaConnectionsTable.projectId,
        set: {
          pageId: page.id,
          pageName: page.name,
          pageAccessToken: page.access_token,
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
