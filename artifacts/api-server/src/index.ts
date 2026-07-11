import app from "./app.js";
import { logger } from "./lib/logger.js";
import { startArchivalJob } from "./lib/archivalJob.js";
import { checkEncryptionKey } from "./lib/tokenCrypto.js";

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
});
