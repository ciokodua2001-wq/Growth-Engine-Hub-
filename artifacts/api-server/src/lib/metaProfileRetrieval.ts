import { eq, and } from "drizzle-orm";
import { db, metaConnectionsTable, businessSourcesTable } from "@workspace/db";
import { decryptToken } from "./tokenCrypto.js";
import { hashContent } from "./contentIntegrity.js";
import type { RetrievedSource } from "./businessSourceIngestor.js";

/**
 * Read-only Meta Graph API profile retrieval.
 *
 * This module ONLY reads data the connected user has explicitly authorized via
 * the existing Meta OAuth flow. It never scrapes, never probes third-party
 * profiles, and never invents values - every field returned is whatever the
 * Graph API actually returned at retrieval time.
 *
 * Permissions used (declared in the existing OAuth scopes):
 *   - pages_read_engagement  -> Facebook Page metadata + recent posts
 *   - instagram_basic        -> Instagram business/creator account profile + media
 *
 * The Graph API version is pinned to match the rest of the Meta integration.
 */

const META_GRAPH = "https://graph.facebook.com/v20.0";

interface MetaErrorBody {
  error?: { code?: number; error_subcode?: number; message?: string };
}

interface FacebookPageProfile {
  id: string;
  name?: string;
  about?: string;
  description?: string;
  category?: string;
  link?: string;
  website?: string;
  fan_count?: number;
}

interface InstagramBusinessProfile {
  id: string;
  username?: string;
  name?: string;
  biography?: string;
  media_count?: number;
  followers_count?: number;
  follows_count?: number;
  website?: string;
}

interface InstagramMediaItem {
  id: string;
  caption?: string;
  media_type?: string;
  permalink?: string;
  timestamp?: string;
}

interface FacebookPostItem {
  id: string;
  message?: string;
  created_time?: string;
}

type FetchResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Minimal Graph API GET with auth, returning parsed JSON or a typed error. */
async function metaGet(path: string, token: string, params: Record<string, string> = {}): Promise<FetchResult<unknown>> {
  const url = new URL(`${META_GRAPH}${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
  } catch (err) {
    return { ok: false, error: `Meta request failed: ${err instanceof Error ? err.message : "network error"}` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: `Meta returned non-JSON (HTTP ${res.status})` };
  }

  if (!res.ok) {
    const eb = body as MetaErrorBody;
    const code = eb?.error?.code ?? res.status;
    const msg = eb?.error?.message ?? `HTTP ${res.status}`;
    if (code === 190 || code === 463 || code === 464 || code === 467) {
      return { ok: false, error: `Meta token expired or invalid (code ${code}): ${msg}` };
    }
    if (code === 10 || code === 200 || code === 100) {
      return { ok: false, error: `Meta permission/param error (code ${code}): ${msg}` };
    }
    return { ok: false, error: `Meta error (code ${code}): ${msg}` };
  }

  return { ok: true, data: body };
}

/** Read the connected Facebook Page's public metadata. */
async function fetchFacebookPageProfile(token: string, pageId: string): Promise<FetchResult<FacebookPageProfile>> {
  const r = await metaGet(`/${pageId}`, token, {
    fields: "id,name,about,description,category,link,website,fan_count",
  });
  if (!r.ok) return r;
  return { ok: true, data: r.data as FacebookPageProfile };
}

/** Read recent Facebook Page posts (message + timestamp). */
async function fetchFacebookRecentPosts(token: string, pageId: string, limit = 6): Promise<FetchResult<FacebookPostItem[]>> {
  const r = await metaGet(`/${pageId}/posts`, token, {
    fields: "id,message,created_time",
    limit: String(limit),
  });
  if (!r.ok) return r;
  const data = (r.data as { data?: FacebookPostItem[] })?.data ?? [];
  return { ok: true, data };
}

/** Read the connected Instagram business/creator account profile. */
async function fetchInstagramProfile(token: string, igUserId: string): Promise<FetchResult<InstagramBusinessProfile>> {
  const r = await metaGet(`/${igUserId}`, token, {
    fields: "id,username,name,biography,media_count,followers_count,follows_count,website",
  });
  if (!r.ok) return r;
  return { ok: true, data: r.data as InstagramBusinessProfile };
}

/** Read recent Instagram media captions (no engagement metrics). */
async function fetchInstagramMedia(token: string, igUserId: string, limit = 6): Promise<FetchResult<InstagramMediaItem[]>> {
  const r = await metaGet(`/${igUserId}/media`, token, {
    fields: "id,caption,media_type,permalink,timestamp",
    limit: String(limit),
  });
  if (!r.ok) return r;
  const data = (r.data as { data?: InstagramMediaItem[] })?.data ?? [];
  return { ok: true, data };
}

export function formatFacebookSource(profile: FacebookPageProfile, posts: FacebookPostItem[]): { text: string; retrieved: string } {
  const lines: string[] = [`[Retrieved via Meta Graph API - Facebook Page]`];
  if (profile.name) lines.push(`Name: ${profile.name}`);
  if (profile.category) lines.push(`Category: ${profile.category}`);
  if (profile.about) lines.push(`About: ${profile.about}`);
  if (profile.description) lines.push(`Description: ${profile.description}`);
  if (profile.website) lines.push(`Website: ${profile.website}`);
  if (profile.link) lines.push(`Page URL: ${profile.link}`);
  if (typeof profile.fan_count === "number") lines.push(`Page followers (as reported by Meta): ${profile.fan_count}`);
  if (posts.length > 0) {
    lines.push(`Recent posts:`);
    for (const p of posts) {
      if (p.message?.trim()) lines.push(`- ${p.message.trim().replace(/\s+/g, " ").slice(0, 400)}`);
    }
  }
  const retrieved = JSON.stringify({ profile, posts });
  return { text: lines.join("\n"), retrieved };
}

export function formatInstagramSource(profile: InstagramBusinessProfile, media: InstagramMediaItem[]): { text: string; retrieved: string } {
  const lines: string[] = [`[Retrieved via Meta Graph API - Instagram]`];
  if (profile.username) lines.push(`Handle: @${profile.username}`);
  if (profile.name) lines.push(`Name: ${profile.name}`);
  if (profile.biography) lines.push(`Bio: ${profile.biography}`);
  if (typeof profile.media_count === "number") lines.push(`Media count (as reported by Meta): ${profile.media_count}`);
  if (typeof profile.followers_count === "number") lines.push(`Followers (as reported by Meta): ${profile.followers_count}`);
  if (profile.website) lines.push(`Website: ${profile.website}`);
  if (media.length > 0) {
    lines.push(`Recent posts:`);
    for (const m of media) {
      if (m.caption?.trim()) lines.push(`- ${m.caption.trim().replace(/\s+/g, " ").slice(0, 400)}`);
    }
  }
  const retrieved = JSON.stringify({ profile, media });
  return { text: lines.join("\n"), retrieved };
}

/**
 * Retrieve authorized Meta profile data for a project and persist it into the
 * business_sources ledger (provenance: retrievalMethod = "meta_graph_api",
 * retrievedAt = now, authorizationStatus = "authorized").
 *
 * Returns the RetrievedSource objects that were actually retrieved (empty array
 * if no connection exists or nothing was readable). Never throws - retrieval
 * failures are returned as empty/partial results so analysis can continue.
 */
export async function retrieveMetaSourcesForProject(projectId: number): Promise<RetrievedSource[]> {
  const [connection] = await db
    .select()
    .from(metaConnectionsTable)
    .where(eq(metaConnectionsTable.projectId, projectId))
    .limit(1);

  if (!connection) return [];

  let token: string;
  try {
    token = decryptToken(connection.pageAccessToken);
  } catch {
    return []; // unreadable token - treat as no retrieval, never block analysis
  }

  const sources: RetrievedSource[] = [];
  const now = new Date();

  // Facebook Page
  const fb = await fetchFacebookPageProfile(token, connection.pageId);
  if (fb.ok) {
    const fbPosts = await fetchFacebookRecentPosts(token, connection.pageId);
    const posts = fbPosts.ok ? fbPosts.data : [];
    const { text, retrieved } = formatFacebookSource(fb.data, posts);
    if (text.trim().length > 0) {
      sources.push({
        sourceType: "facebook",
        sourceUrl: fb.data.link ?? `https://facebook.com/${connection.pageId}`,
        declaredContent: null,
        retrievedContent: retrieved,
        retrievalMethod: "meta_graph_api",
        retrievedAt: now,
        title: fb.data.name ?? null,
        metaDescription: fb.data.description ?? fb.data.about ?? null,
        text,
      });
    }
  }

  // Instagram business/creator account (if linked)
  if (connection.instagramAccountId) {
    const ig = await fetchInstagramProfile(token, connection.instagramAccountId);
    if (ig.ok) {
      const igMedia = await fetchInstagramMedia(token, connection.instagramAccountId);
      const media = igMedia.ok ? igMedia.data : [];
      const { text, retrieved } = formatInstagramSource(ig.data, media);
      if (text.trim().length > 0) {
        sources.push({
          sourceType: "instagram",
          sourceUrl: ig.data.username ? `https://instagram.com/${ig.data.username}` : null,
          declaredContent: null,
          retrievedContent: retrieved,
          retrievalMethod: "meta_graph_api",
          retrievedAt: now,
          title: ig.data.name ?? ig.data.username ?? null,
          metaDescription: ig.data.biography ?? null,
          text,
        });
      }
    }
  }

  // Persist retrieved content into the source ledger (distinct from declared).
  for (const s of sources) {
    const sourceValue = s.sourceUrl ?? s.sourceType;
    const [existing] = await db
      .select({ id: businessSourcesTable.id })
      .from(businessSourcesTable)
      .where(
        and(
          eq(businessSourcesTable.projectId, projectId),
          eq(businessSourcesTable.sourceType, s.sourceType),
          eq(businessSourcesTable.sourceValue, sourceValue),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(businessSourcesTable)
        .set({
          authorizationStatus: "authorized",
          retrievedContent: s.retrievedContent,
          retrievalMethod: "meta_graph_api",
          retrievedAt: now,
          contentHash: hashContent(s.text),
          status: "active",
        })
        .where(eq(businessSourcesTable.id, existing.id));
    } else {
      await db.insert(businessSourcesTable).values({
        projectId,
        sourceType: s.sourceType,
        sourceUrl: s.sourceUrl,
        sourceValue,
        displayLabel: s.sourceUrl ?? s.sourceType,
        authorizationStatus: "authorized",
        retrievalMethod: "meta_graph_api",
        retrievedAt: now,
        contentHash: hashContent(s.text),
        declaredContent: null,
        retrievedContent: s.retrievedContent,
        status: "active",
      });
    }
  }

  return sources;
}
