import { Router } from "express";
import { requireProjectOwnershipParam } from "../lib/authz.js";
import { getQuotaUsage } from "../lib/planLimits.js";

const router = Router();

router.param("id", requireProjectOwnershipParam());

router.get("/projects/:id/usage", async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const result = await getQuotaUsage(projectId);
  if (!result) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(result);
});

export default router;
