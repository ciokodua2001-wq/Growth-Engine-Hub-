import app from "./app.js";
import { logger } from "./lib/logger.js";
import { startArchivalJob } from "./lib/archivalJob.js";
import { startStuckPublishRecovery } from "./lib/stuckPublishRecovery.js";
import { startScheduledPublisher } from "./lib/scheduledPublisher.js";
import { checkEncryptionKey, isEncryptedFormat, decryptToken } from "./lib/tokenCrypto.js";
import { db } from "@workspace/db";
import { metaConnectionsTable } from "@workspace/db";

// Startup key check — surface missing/invalid TOKEN_ENCRYPTION_KEY before any user
// hits a publish failure.  We check the dedicated key specifically (not the
// SESSION_SECRET fallback) because rotating SESSION_SECRET without migrating tokens
// makes all stored page tokens permanently unreadable.
const _keyCheck = checkEncryptionKey();
if (!_keyCheck.ok) {
  logger.error(
    { reason: _keyCheck.reason },
    "STARTUP ERROR: TOKEN_ENCRYPTION_KEY is absent or invalid — stored Meta page tokens may not be decryptable. Set TOKEN_ENCRYPTION_KEY in your environment before users try to publish."
  );
}

// Startup Meta token health scan — runs once after the server starts listening.
// Tries to decrypt every stored page-access token with the current key and logs
// a prominent error listing affected project IDs if any fail.  This surfaces
// key-rotation fallout immediately instead of waiting for user publish failures.
async function runMetaTokenHealthCheck(): Promise<void> {
  try {
    const rows = await db
      .select({
        id: metaConnectionsTable.id,
        projectId: metaConnectionsTable.projectId,
        pageAccessToken: metaConnectionsTable.pageAccessToken,
      })
      .from(metaConnectionsTable);

    if (rows.length === 0) return;

    let healthy = 0;
    const failedProjectIds: number[] = [];

    for (const row of rows) {
      try {
        if (isEncryptedFormat(row.pageAccessToken)) {
          decryptToken(row.pageAccessToken);
        }
        healthy++;
      } catch {
        failedProjectIds.push(row.projectId);
      }
    }

    if (failedProjectIds.length > 0) {
      logger.error(
        { total: rows.length, healthy, failed: failedProjectIds.length, affectedProjectIds: failedProjectIds },
        `STARTUP ALERT: ${failedProjectIds.length} of ${rows.length} Meta page token(s) cannot be decrypted with the current key. ` +
        `Affected project IDs: [${failedProjectIds.join(", ")}]. ` +
        "These users will not be able to publish to Facebook/Instagram until they reconnect. " +
        "Run POST /admin/meta/re-encrypt-tokens to attempt migration, or ask affected users to reconnect via Social Hub."
      );
    } else {
      logger.info({ total: rows.length, healthy }, "Startup: all Meta page tokens decrypt successfully with current key.");
    }
  } catch (err) {
    logger.warn({ err }, "Startup: Meta token health check could not complete (DB may not be ready yet).");
  }
}

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");

const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
  startArchivalJob();
  startStuckPublishRecovery();
  startScheduledPublisher();
  void runMetaTokenHealthCheck();
});
