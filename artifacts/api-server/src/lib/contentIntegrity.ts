import { createHash } from "node:crypto";
import { db } from "@workspace/db";
import { contentIntegrityLogTable, usersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

export type ContentType =
  | "business_analysis"
  | "personas"
  | "marketing_strategy"
  | "competitors"
  | "competitor_report"
  | "social_posts"
  | "email_campaign"
  | "video_blueprints"
  | "ad_creatives"
  | "content"
  | "agent_message"
  | "report";

export function hashContent(data: unknown): string {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

async function getIsTestAccount(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ isOwner: usersTable.isOwner, role: usersTable.role, isTestAccount: usersTable.isTestAccount })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!user) return false;
  return user.isOwner || user.isTestAccount || ["admin", "super_admin"].includes(user.role ?? "");
}

export async function recordGenerated(params: {
  userId: string;
  projectId: number | null;
  contentType: ContentType;
  contentId: string;
  contentHash: string;
  summary?: string;
}): Promise<void> {
  const isTestAccount = await getIsTestAccount(params.userId);
  await db.insert(contentIntegrityLogTable).values({
    userId: params.userId,
    projectId: params.projectId ?? null,
    contentType: params.contentType,
    contentId: params.contentId,
    contentHash: params.contentHash,
    summary: params.summary ?? null,
    isTestAccount,
  });
}

export async function recordGeneratedBatch(params: {
  userId: string;
  projectId: number | null;
  contentType: ContentType;
  items: Array<{ id: string | number; data: unknown; summary?: string }>;
}): Promise<void> {
  if (params.items.length === 0) return;
  const isTestAccount = await getIsTestAccount(params.userId);
  await db.insert(contentIntegrityLogTable).values(
    params.items.map((item) => ({
      userId: params.userId,
      projectId: params.projectId ?? null,
      contentType: params.contentType,
      contentId: String(item.id),
      contentHash: hashContent(item.data),
      summary: item.summary ?? null,
      isTestAccount,
    })),
  );
}

export async function recordAccessed(
  userId: string,
  contentType: ContentType,
  contentId: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(contentIntegrityLogTable)
    .set({
      lastAccessedAt: now,
      firstAccessedAt: sql`COALESCE(${contentIntegrityLogTable.firstAccessedAt}, ${now}::timestamptz)`,
      accessCount: sql`${contentIntegrityLogTable.accessCount} + 1`,
    })
    .where(
      and(
        eq(contentIntegrityLogTable.userId, userId),
        eq(contentIntegrityLogTable.contentType, contentType),
        eq(contentIntegrityLogTable.contentId, contentId),
      ),
    );
}
