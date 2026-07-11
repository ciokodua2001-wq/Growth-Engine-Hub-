import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { checkEncryptionKey } from "../lib/tokenCrypto.js";

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

export default router;
