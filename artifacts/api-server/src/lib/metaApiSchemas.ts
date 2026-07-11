import { z } from "zod/v4";

/**
 * Thrown when Meta's Graph API returns a JSON body that matches the known error
 * shape `{ error: { message: string } }` — a definitive rejection.
 *
 * Because Meta explicitly rejected the request (no post was created), it is safe
 * to roll the social post back to "draft" so the user can retry.
 */
export class GraphApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphApiError";
  }
}

/**
 * Thrown when the Meta Graph API returns a JSON response whose shape doesn't
 * match either the expected success shape or the known error shape.
 *
 * This typically means an API version bump renamed or wrapped a field. Unlike
 * a GraphApiError, we cannot confirm whether the publish succeeded or failed —
 * treat it like an ambiguous transport failure: do NOT roll back to draft.
 */
export class MetaApiShapeError extends Error {
  constructor(context: string, body: unknown) {
    const preview = JSON.stringify(body).slice(0, 300);
    super(
      `Unexpected Meta API response shape during ${context}. ` +
        `This may indicate a Graph API version change. Response preview: ${preview}`,
    );
    this.name = "MetaApiShapeError";
  }
}

const MetaSuccessSchema = z.object({ id: z.string() });
const MetaErrorSchema = z.object({ error: z.object({ message: z.string() }) });

/**
 * Parses a raw Meta Graph API JSON response body and returns the `id` string.
 *
 * Throws:
 *  - `GraphApiError`      — body matches `{ error: { message } }` (definitive rejection)
 *  - `MetaApiShapeError`  — body matches neither success nor error shape (unexpected shape)
 *
 * @param context   Human-readable label used in the MetaApiShapeError message
 *                  (e.g. "Facebook feed POST", "Instagram container creation").
 * @param body      The parsed JSON value from the API response.
 */
export function parseMetaApiResponse(context: string, body: unknown): string {
  const successResult = MetaSuccessSchema.safeParse(body);
  if (successResult.success) {
    return successResult.data.id;
  }

  const errorResult = MetaErrorSchema.safeParse(body);
  if (errorResult.success) {
    throw new GraphApiError(errorResult.data.error.message);
  }

  throw new MetaApiShapeError(context, body);
}
