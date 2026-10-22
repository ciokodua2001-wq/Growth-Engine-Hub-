import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { checkEncryptionKey } from "../lib/tokenCrypto.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const keyCheck = checkEncryptionKey();
  if (!keyCheck.ok) {
    res.status(503).json({
      status: "unhealthy",
      reason: keyCheck.reason ?? "Token encryption key unavailable — set TOKEN_ENCRYPTION_KEY or SESSION_SECRET",
    });
    return;
  }
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/version", (_req, res) => {
  let commit = "unknown";
  let buildTime: string | null = null;
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const info = JSON.parse(readFileSync(path.join(dir, "build-info.json"), "utf8"));
    commit = info.commit ?? "unknown";
    buildTime = info.buildTime ?? null;
  } catch {
    // build-info.json absent (older build) — report unknown
  }
  res.json({ commit, buildTime, env: process.env.APP_ENV ?? "unknown", node: process.version });
});

export default router;
