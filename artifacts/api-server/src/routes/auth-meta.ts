import { Router, type IRouter } from "express";
import { getAuth } from "../lib/supabaseAuth.js";
import { db } from "@workspace/db";
import { metaConnectionsTable, metaPageSessionsTable } from "@workspace/db";
import { eq, lt, and } from "drizzle-orm";
import crypto from "node:crypto";
import { requireUserId, loadOwnedProject } from "../lib/authz.js";
import { encryptToken, decryptToken, signState, verifyState } from "../lib/tokenCrypto.js";

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

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface PendingPage {
  id: string;
  name: string;
  access_token: string;
}

/**
 * Persists a multi-page picker session to the database.
 * Access tokens within the pages list are encrypted before storage.
 * Expired rows are purged on every write (cheap because the index on
 * expires_at keeps the scan fast).
 * Returns the opaque session token.
 */
async function storePendingPages(
  projectId: number,
  userId: string,
  pages: PendingPage[],
): Promise<string> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  // Purge stale rows so the table stays small
  await db
    .delete(metaPageSessionsTable)
    .where(lt(metaPageSessionsTable.expiresAt, new Date()));

  const token = crypto.randomBytes(24).toString("hex");
  const pagesEncrypted = encryptToken(JSON.stringify(pages));

  await db.insert(metaPageSessionsTable).values({
    token,
    projectId,
    userId,
    pagesEncrypted,
    expiresAt,
  });

  return token;
}

/**
 * Loads and validates a pending session from the database.
 * Returns null (and deletes the row) if it doesn't exist, is expired, or
 * belongs to a different user.
 */
async function loadPendingSession(
  token: string,
  userId: string,
): Promise<{ projectId: number; pages: PendingPage[] } | null> {
  const [row] = await db
    .select()
    .from(metaPageSessionsTable)
    .where(eq(metaPageSessionsTable.token, token))
    .limit(1);

  if (!row) return null;

  // Expired — clean up and reject
  if (row.expiresAt < new Date()) {
    await db.delete(metaPageSessionsTable).where(eq(metaPageSessionsTable.token, token));
    return null;
  }

  // Wrong user — reject without revealing the session exists
  if (row.userId !== userId) return null;

  let pages: PendingPage[];
  try {
    pages = JSON.parse(decryptToken(row.pagesEncrypted)) as PendingPage[];
  } catch {
    await db.delete(metaPageSessionsTable).where(eq(metaPageSessionsTable.token, token));
    return null;
  }

  return { projectId: row.projectId, pages };
}

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

  const project = await loadOwnedProject(userId, projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  if (!META_APP_ID) {
    res.status(503).json({ error: "Meta app not configured" });
    return;
  }

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
 * Exchanges the authorization code for a long-lived Page access token.
 *
 * If the user has exactly one Page: immediately saves the connection and
 * redirects to the dashboard with meta_connected=1.
 *
 * If the user has multiple Pages: persists the pages list to the DB with a
 * 5-minute TTL and redirects to the social hub with a meta_pages token so
 * the user can pick which page to connect. The session survives server restarts.
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

  const callbackUserId = getAuth(req)?.userId;
  if (!callbackUserId || callbackUserId !== stateUserId) {
    req.log.warn({ callbackUserId, stateUserId }, "Meta OAuth user mismatch");
    res.redirect("/dashboard?meta_error=user_mismatch");
    return;
  }

  const project = await loadOwnedProject(callbackUserId, projectId);
  if (!project) {
    req.log.warn({ callbackUserId, projectId }, "Meta OAuth project not owned");
    res.redirect("/dashboard?meta_error=not_authorized");
    return;
  }

  try {
    // Exchange code for short-lived user access token
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

    // Exchange for long-lived user access token (60 days)
    const llUrl = new URL("https://graph.facebook.com/v20.0/oauth/access_token");
    llUrl.searchParams.set("grant_type", "fb_exchange_token");
    llUrl.searchParams.set("client_id", META_APP_ID);
    llUrl.searchParams.set("client_secret", META_APP_SECRET);
    llUrl.searchParams.set("fb_exchange_token", userToken);

    const llRes = await fetch(llUrl.toString());
    const llData = await llRes.json() as { access_token?: string };
    const longLivedToken = llData.access_token ?? userToken;

    // Get Pages (id, name, and their never-expiring Page access tokens)
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

    // Single page — skip the picker, connect immediately
    if (pages.length === 1) {
      await connectPage(projectId, pages[0]);
      req.log.info({ projectId, pageId: pages[0].id }, "Meta account connected (single page)");
      res.redirect(`/dashboard?meta_connected=1&projectId=${projectId}`);
      return;
    }

    // Multiple pages — persist to DB and redirect to the picker
    const token = await storePendingPages(projectId, callbackUserId, pages);
    req.log.info({ projectId, pageCount: pages.length }, "Multiple Meta pages — showing picker");
    res.redirect(`/projects/${projectId}/social?meta_pages=${token}`);
  } catch (err) {
    req.log.error({ err }, "Meta OAuth callback error");
    res.redirect("/dashboard?meta_error=server_error");
  }
});

/**
 * GET /auth/meta/pages?token=<token>
 * Returns the list of available Facebook Pages for a pending picker session.
 * Only returns page id + name (never access tokens).
 * Session is read from the database so it survives server restarts.
 */
router.get("/auth/meta/pages", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const token = req.query.token as string;
  if (!token) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  const session = await loadPendingSession(token, userId);
  if (!session) {
    res.status(404).json({
      error: "Page selection session not found or expired. Please reconnect your Facebook account.",
    });
    return;
  }

  res.json({
    projectId: session.projectId,
    pages: session.pages.map(p => ({ id: p.id, name: p.name })),
  });
});

/**
 * POST /auth/meta/select-page
 * Selects a Facebook Page from a pending picker session and commits the
 * connection. Deletes the session row after successful selection.
 */
router.post("/auth/meta/select-page", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const { token, pageId } = req.body as { token?: string; pageId?: string };
  if (!token || !pageId) {
    res.status(400).json({ error: "token and pageId are required" });
    return;
  }

  const session = await loadPendingSession(token, userId);
  if (!session) {
    res.status(404).json({
      error: "Page selection session not found or expired. Please reconnect your Facebook account.",
    });
    return;
  }

  const page = session.pages.find(p => p.id === pageId);
  if (!page) {
    res.status(404).json({ error: "Selected page not in list" });
    return;
  }

  // Re-verify project ownership before committing
  const project = await loadOwnedProject(userId, session.projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  try {
    await connectPage(session.projectId, page);

    // Delete the session — it's single-use
    await db.delete(metaPageSessionsTable).where(eq(metaPageSessionsTable.token, token));

    req.log.info({ projectId: session.projectId, pageId: page.id }, "Meta account connected via picker");

    res.json({
      connected: true,
      pageId: page.id,
      pageName: page.name,
    });
  } catch (err) {
    req.log.error({ err }, "Meta select-page error");
    res.status(500).json({ error: "Failed to connect page" });
  }
});

/**
 * Looks up the Instagram Business Account for a page and upserts the
 * meta_connections row. Shared by both the single-page fast path and the
 * picker-based selection path.
 */
async function connectPage(
  projectId: number,
  page: { id: string; name: string; access_token: string },
): Promise<void> {
  const igUrl = new URL(`https://graph.facebook.com/v20.0/${page.id}`);
  igUrl.searchParams.set("fields", "instagram_business_account");
  igUrl.searchParams.set("access_token", page.access_token);

  const igRes = await fetch(igUrl.toString());
  const igData = await igRes.json() as {
    instagram_business_account?: { id: string };
  };

  const instagramAccountId = igData.instagram_business_account?.id ?? null;
  const encryptedToken = encryptToken(page.access_token);

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
}

export default router;
