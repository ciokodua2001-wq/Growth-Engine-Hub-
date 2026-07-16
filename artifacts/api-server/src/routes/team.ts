import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { teamMembersTable, projectsTable } from "@workspace/db";
import { requireUserId, requireProjectOwnershipParam, requireOwnerOnly } from "../lib/authz.js";
import { z } from "zod/v4";
import { randomBytes } from "crypto";
import { Resend } from "resend";

const router = Router();

router.param("id", requireProjectOwnershipParam());

// ── List team members ────────────────────────────────────────────────────────
router.get("/projects/:id/team", async (req, res): Promise<void> => {
  const projectId = req.project!.id;
  const members = await db
    .select()
    .from(teamMembersTable)
    .where(
      and(
        eq(teamMembersTable.projectId, projectId),
        // exclude revoked from list shown to non-owners? No — show all so owner can re-invite
      )
    );
  res.json({ members });
});

// ── Invite a team member ──────────────────────────────────────────────────────
router.post("/projects/:id/team/invite", requireOwnerOnly, async (req, res): Promise<void> => {
  const project = req.project!;

  if (project.plan !== "agency") {
    res.status(403).json({ error: "Team Members are available on the Agency plan only. Upgrade to unlock this feature." });
    return;
  }

  const schema = z.object({ email: z.string().email(), role: z.enum(["member", "admin"]).default("member") });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const { email, role } = parsed.data;

  // Check if already a member
  const [existing] = await db
    .select()
    .from(teamMembersTable)
    .where(and(eq(teamMembersTable.projectId, project.id), eq(teamMembersTable.email, email)));
  if (existing && existing.status === "active") {
    res.status(409).json({ error: "This person is already an active team member." });
    return;
  }

  const token = randomBytes(32).toString("hex");
  const userId = requireUserId(req, res);
  if (!userId) return;

  if (existing) {
    // Resend invite (update token + reset to pending)
    await db
      .update(teamMembersTable)
      .set({ inviteToken: token, status: "pending", invitedAt: new Date(), acceptedAt: null, role, invitedByUserId: userId })
      .where(eq(teamMembersTable.id, existing.id));
  } else {
    await db.insert(teamMembersTable).values({
      projectId: project.id,
      invitedByUserId: userId,
      email,
      role,
      status: "pending",
      inviteToken: token,
    });
  }

  // Send invite email
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    const resend = new Resend(apiKey);
    const domain = (process.env.REPLIT_DOMAINS ?? "").split(",")[0]?.trim();
    const appUrl = domain ? `https://${domain}` : "https://usegrowthforge.com";
    const acceptUrl = `${appUrl}/team/accept?token=${token}`;

    await resend.emails.send({
      from: "GrowthForge AI <team@usegrowthforge.com>",
      to: [email],
      subject: `You've been invited to collaborate on ${project.name}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#040B14;color:#fff;border-radius:12px;overflow:hidden;">
          <div style="padding:24px 32px;background:#040B14;border-bottom:1px solid #1a2a3a;">
            <span style="color:#00E676;font-size:20px;font-weight:900;letter-spacing:-0.5px;">GrowthForge AI</span>
          </div>
          <div style="padding:32px;">
            <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;">You're invited to join a project</h2>
            <p style="color:#7a8fa6;margin:0 0 24px;">You've been invited to collaborate on <strong style="color:#fff;">${project.name}</strong> on GrowthForge AI.</p>
            <a href="${acceptUrl}" style="display:inline-block;background:#00E676;color:#040B14;font-weight:700;padding:14px 28px;border-radius:10px;text-decoration:none;font-size:15px;">Accept Invitation</a>
            <p style="color:#4a5f72;font-size:12px;margin-top:24px;">Or copy this link: ${acceptUrl}</p>
            <p style="color:#4a5f72;font-size:12px;margin-top:8px;">If you didn't expect this invitation, you can safely ignore this email.</p>
          </div>
        </div>
      `,
    }).catch((err) => req.log?.warn({ err }, "Team invite email failed to send"));
  }

  res.status(201).json({ ok: true, message: `Invitation sent to ${email}` });
});

// ── Remove / revoke a team member ────────────────────────────────────────────
router.delete("/projects/:id/team/:memberId", requireOwnerOnly, async (req, res): Promise<void> => {
  const projectId = req.project!.id;
  const memberId = parseInt(req.params.memberId, 10);
  if (isNaN(memberId)) { res.status(400).json({ error: "Invalid member id" }); return; }

  const [member] = await db
    .select()
    .from(teamMembersTable)
    .where(and(eq(teamMembersTable.id, memberId), eq(teamMembersTable.projectId, projectId)));
  if (!member) { res.status(404).json({ error: "Team member not found" }); return; }

  await db
    .update(teamMembersTable)
    .set({ status: "revoked" })
    .where(eq(teamMembersTable.id, memberId));

  res.json({ ok: true });
});

// ── Accept invite (authenticated) ────────────────────────────────────────────
router.post("/team/accept", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const schema = z.object({ token: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Missing token" }); return; }

  const [member] = await db
    .select()
    .from(teamMembersTable)
    .where(eq(teamMembersTable.inviteToken, parsed.data.token));

  if (!member) { res.status(404).json({ error: "Invitation not found or already used." }); return; }
  if (member.status === "active") { res.json({ ok: true, projectId: member.projectId, alreadyMember: true }); return; }
  if (member.status === "revoked") { res.status(403).json({ error: "This invitation has been revoked." }); return; }

  await db
    .update(teamMembersTable)
    .set({ userId, status: "active", acceptedAt: new Date(), inviteToken: null })
    .where(eq(teamMembersTable.id, member.id));

  const [project] = await db
    .select({ id: projectsTable.id, name: projectsTable.name })
    .from(projectsTable)
    .where(eq(projectsTable.id, member.projectId));

  res.json({ ok: true, projectId: member.projectId, projectName: project?.name });
});

export default router;
