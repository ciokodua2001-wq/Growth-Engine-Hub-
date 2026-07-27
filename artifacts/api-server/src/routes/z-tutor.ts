import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  zStudentProfilesTable,
  zSessionsTable,
  zMessagesTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, count, and } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { requireUserId } from "../lib/authz.js";

const router: IRouter = Router();

// ── nano-id style ID generator ──────────────────────────────────────────────
function nanoid(size = 21): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < size; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// ── Free tier constants ──────────────────────────────────────────────────────
const FREE_SESSION_LIMIT = 10;
// Default paid monthly limit if admin hasn't set one
const DEFAULT_PAID_MONTHLY_LIMIT = 200;

// ── Z Tutor AI system prompt ─────────────────────────────────────────────────
function buildSystemPrompt(params: {
  country: string | null;
  province: string | null;
  grade: string | null;
  subject: string;
  lesson: string;
  unit: string;
}): string {
  const location = [params.province, params.country].filter(Boolean).join(", ") || "Not specified";
  return `You are Z, an AI tutor for the Quantivarian learning platform.

## Student Context
- Location: ${location}
- Grade: ${params.grade ?? "Not specified"}
- Subject: ${params.subject}
- Unit: ${params.unit}
- Lesson: ${params.lesson}

## Your Role
You are a patient, encouraging tutor helping a student understand their curriculum. You must:

1. **Stay on curriculum** — Only discuss topics directly related to the specified subject, unit, and lesson. Politely decline off-topic questions by redirecting to the lesson.
2. **Never give the final answer immediately** — Instead, break problems into steps, ask guiding questions, and provide hints that help the student arrive at the answer themselves.
3. **Promote active learning** — Use the Socratic method. Ask "What do you think?" and "What have you tried?" before explaining.
4. **Be encouraging** — Celebrate progress, normalise mistakes as part of learning, and keep a warm and supportive tone.
5. **Adapt to grade level** — Match your vocabulary and complexity to the student's grade level.
6. **Keep responses concise** — 2–4 short paragraphs maximum. Use bullet points and numbered steps for clarity.

## What you can do
- Explain concepts from the current lesson
- Give hints without revealing full solutions
- Generate worked examples (similar to, not identical to, homework problems)
- Clarify confusing terms
- Encourage the student to keep going

## What you must not do
- Answer questions about other subjects, grades, or unrelated topics
- Provide complete answers to problems without guiding the student first
- Discuss anything unrelated to the student's education`;
}

// ── require auth helper ─────────────────────────────────────────────────────
async function requireZAdmin(req: Parameters<typeof requireUserId>[0], res: Parameters<typeof requireUserId>[1]): Promise<string | null> {
  const userId = requireUserId(req, res);
  if (!userId) return null;
  const [user] = await db.select({ isOwner: usersTable.isOwner }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user?.isOwner) {
    res.status(403).json({ error: "Forbidden — admin only." });
    return null;
  }
  return userId;
}

// ── GET /z/profile ──────────────────────────────────────────────────────────
router.get("/z/profile", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  try {
    const [profile] = await db
      .select()
      .from(zStudentProfilesTable)
      .where(eq(zStudentProfilesTable.userId, userId));
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    res.json(profile);
  } catch (err) {
    console.error("GET /z/profile error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PUT /z/profile ──────────────────────────────────────────────────────────
router.put("/z/profile", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  try {
    const { country, province, grade } = req.body as {
      country?: string;
      province?: string;
      grade?: string;
    };

    const [existing] = await db
      .select()
      .from(zStudentProfilesTable)
      .where(eq(zStudentProfilesTable.userId, userId));

    if (existing) {
      const [updated] = await db
        .update(zStudentProfilesTable)
        .set({
          country: country ?? existing.country,
          province: province ?? existing.province,
          grade: grade ?? existing.grade,
          updatedAt: new Date(),
        })
        .where(eq(zStudentProfilesTable.userId, userId))
        .returning();
      res.json(updated);
    } else {
      const [created] = await db
        .insert(zStudentProfilesTable)
        .values({
          userId,
          country: country ?? null,
          province: province ?? null,
          grade: grade ?? null,
          plan: "free",
          questionsUsedThisSession: 0,
          questionsUsedThisMonth: 0,
        })
        .returning();
      res.json(created);
    }
  } catch (err) {
    console.error("PUT /z/profile error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /z/quota ─────────────────────────────────────────────────────────────
router.get("/z/quota", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  try {
    const [profile] = await db
      .select()
      .from(zStudentProfilesTable)
      .where(eq(zStudentProfilesTable.userId, userId));

    if (!profile) {
      // No profile yet — treat as free trial
      res.json({
        plan: "free",
        used: 0,
        limit: FREE_SESSION_LIMIT,
        remaining: FREE_SESSION_LIMIT,
        resetAt: null,
      });
      return;
    }

    // Check monthly reset for paid users
    let used = profile.questionsUsedThisSession;
    let limit = FREE_SESSION_LIMIT;
    let resetAt: string | null = null;

    if (profile.plan === "paid") {
      used = profile.questionsUsedThisMonth;
      limit = profile.monthlyLimit ?? DEFAULT_PAID_MONTHLY_LIMIT;

      // Auto-reset if past monthly boundary
      if (profile.lastResetAt) {
        const resetDate = new Date(profile.lastResetAt);
        const nextReset = new Date(resetDate);
        nextReset.setMonth(nextReset.getMonth() + 1);
        resetAt = nextReset.toISOString();

        if (Date.now() > nextReset.getTime()) {
          await db
            .update(zStudentProfilesTable)
            .set({ questionsUsedThisMonth: 0, lastResetAt: new Date(), updatedAt: new Date() })
            .where(eq(zStudentProfilesTable.userId, userId));
          used = 0;
          resetAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        }
      }
    }

    res.json({
      plan: profile.plan,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      resetAt,
    });
  } catch (err) {
    console.error("GET /z/quota error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /z/sessions ──────────────────────────────────────────────────────────
router.get("/z/sessions", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  try {
    const sessions = await db
      .select()
      .from(zSessionsTable)
      .where(eq(zSessionsTable.userId, userId))
      .orderBy(desc(zSessionsTable.createdAt))
      .limit(50);

    // Attach message counts
    const sessionIds = sessions.map((s) => s.id);
    const countMap = new Map<string, number>();
    if (sessionIds.length > 0) {
      for (const sessionId of sessionIds) {
        const [row] = await db
          .select({ c: count() })
          .from(zMessagesTable)
          .where(eq(zMessagesTable.sessionId, sessionId));
        countMap.set(sessionId, row?.c ?? 0);
      }
    }

    const result = sessions.map((s) => ({
      ...s,
      messageCount: countMap.get(s.id) ?? 0,
    }));

    res.json(result);
  } catch (err) {
    console.error("GET /z/sessions error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /z/sessions ─────────────────────────────────────────────────────────
router.post("/z/sessions", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  try {
    const { subject, lesson, unit } = req.body as {
      subject?: string;
      lesson?: string;
      unit?: string;
    };

    if (!subject || !lesson || !unit) {
      res.status(400).json({ error: "subject, lesson, and unit are required" });
      return;
    }

    // Reset session question counter for this new session (free users)
    await db
      .update(zStudentProfilesTable)
      .set({ questionsUsedThisSession: 0, updatedAt: new Date() })
      .where(eq(zStudentProfilesTable.userId, userId));

    const [session] = await db
      .insert(zSessionsTable)
      .values({
        id: nanoid(),
        userId,
        subject,
        lesson,
        unit,
      })
      .returning();

    res.status(201).json({ ...session, messageCount: 0 });
  } catch (err) {
    console.error("POST /z/sessions error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /z/sessions/:id ──────────────────────────────────────────────────────
router.get("/z/sessions/:sessionId", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  try {
    const { sessionId } = req.params;
    const [session] = await db
      .select()
      .from(zSessionsTable)
      .where(and(eq(zSessionsTable.id, sessionId), eq(zSessionsTable.userId, userId)));

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const messages = await db
      .select()
      .from(zMessagesTable)
      .where(eq(zMessagesTable.sessionId, sessionId))
      .orderBy(zMessagesTable.createdAt);

    res.json({ ...session, messageCount: messages.length, messages });
  } catch (err) {
    console.error("GET /z/sessions/:id error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /z/sessions/:id/chat ─────────────────────────────────────────────────
router.post("/z/sessions/:sessionId/chat", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  try {
    const { sessionId } = req.params;
    const { message } = req.body as { message?: string };

    if (!message?.trim()) {
      res.status(400).json({ error: "message is required" });
      return;
    }

    // Load session
    const [session] = await db
      .select()
      .from(zSessionsTable)
      .where(and(eq(zSessionsTable.id, sessionId), eq(zSessionsTable.userId, userId)));

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // Load or create profile
    let [profile] = await db
      .select()
      .from(zStudentProfilesTable)
      .where(eq(zStudentProfilesTable.userId, userId));

    if (!profile) {
      [profile] = await db
        .insert(zStudentProfilesTable)
        .values({
          userId,
          plan: "free",
          questionsUsedThisSession: 0,
          questionsUsedThisMonth: 0,
        })
        .returning();
    }

    // ── Quota check ──────────────────────────────────────────────────────────
    const isPaid = profile.plan === "paid";

    if (isPaid) {
      // Check monthly reset
      if (profile.lastResetAt) {
        const nextReset = new Date(profile.lastResetAt);
        nextReset.setMonth(nextReset.getMonth() + 1);
        if (Date.now() > nextReset.getTime()) {
          await db
            .update(zStudentProfilesTable)
            .set({ questionsUsedThisMonth: 0, lastResetAt: new Date(), updatedAt: new Date() })
            .where(eq(zStudentProfilesTable.userId, userId));
          profile.questionsUsedThisMonth = 0;
        }
      }
      const limit = profile.monthlyLimit ?? DEFAULT_PAID_MONTHLY_LIMIT;
      if (profile.questionsUsedThisMonth >= limit) {
        res.status(402).json({
          error: "Monthly question limit reached. Upgrade or wait for your monthly reset.",
          plan: "paid",
          used: profile.questionsUsedThisMonth,
          limit,
        });
        return;
      }
    } else {
      if (profile.questionsUsedThisSession >= FREE_SESSION_LIMIT) {
        res.status(402).json({
          error: `Free sessions are limited to ${FREE_SESSION_LIMIT} questions. Upgrade for unlimited monthly questions.`,
          plan: "free",
          used: profile.questionsUsedThisSession,
          limit: FREE_SESSION_LIMIT,
        });
        return;
      }
    }

    // ── Load conversation history ─────────────────────────────────────────────
    const history = await db
      .select()
      .from(zMessagesTable)
      .where(eq(zMessagesTable.sessionId, sessionId))
      .orderBy(zMessagesTable.createdAt);

    // Save user message
    const userMsgId = nanoid();
    await db.insert(zMessagesTable).values({
      id: userMsgId,
      sessionId,
      role: "user",
      content: message.trim(),
    });

    // Build messages array for Claude
    const conversationMessages = [
      ...history.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user" as const, content: message.trim() },
    ];

    // ── Call Claude ──────────────────────────────────────────────────────────
    const systemPrompt = buildSystemPrompt({
      country: profile.country,
      province: profile.province,
      grade: profile.grade,
      subject: session.subject,
      lesson: session.lesson,
      unit: session.unit,
    });

    const aiMessage = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: systemPrompt,
      messages: conversationMessages,
    });

    const aiText = aiMessage.content[0]?.type === "text" ? aiMessage.content[0].text : "I'm sorry, I couldn't generate a response. Please try again.";

    // Save AI response
    const aiMsgId = nanoid();
    await db.insert(zMessagesTable).values({
      id: aiMsgId,
      sessionId,
      role: "assistant",
      content: aiText,
    });

    // ── Increment quota ──────────────────────────────────────────────────────
    if (isPaid) {
      await db
        .update(zStudentProfilesTable)
        .set({
          questionsUsedThisMonth: (profile.questionsUsedThisMonth ?? 0) + 1,
          lastResetAt: profile.lastResetAt ?? new Date(),
          updatedAt: new Date(),
        })
        .where(eq(zStudentProfilesTable.userId, userId));
    } else {
      await db
        .update(zStudentProfilesTable)
        .set({
          questionsUsedThisSession: (profile.questionsUsedThisSession ?? 0) + 1,
          updatedAt: new Date(),
        })
        .where(eq(zStudentProfilesTable.userId, userId));
    }

    const [savedMsg] = await db
      .select()
      .from(zMessagesTable)
      .where(eq(zMessagesTable.id, aiMsgId));

    res.json(savedMsg);
  } catch (err) {
    console.error("POST /z/sessions/:id/chat error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /z/tts ──────────────────────────────────────────────────────────────
router.post("/z/tts", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  try {
    const { text, voiceId } = req.body as { text?: string; voiceId?: string };

    if (!text?.trim()) {
      res.status(400).json({ error: "text is required" });
      return;
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "TTS is not configured" });
      return;
    }

    const selectedVoiceId = voiceId ?? "EXAVITQu4vr4xnSDxMaL"; // Default: Bella
    const elevenResp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: text.trim().slice(0, 2000),
          model_id: "eleven_turbo_v2_5",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      }
    );

    if (!elevenResp.ok) {
      const errText = await elevenResp.text();
      console.error("ElevenLabs TTS error", elevenResp.status, errText);
      res.status(502).json({ error: "TTS generation failed" });
      return;
    }

    const audioBuffer = await elevenResp.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString("base64");

    res.json({ audioBase64, mimeType: "audio/mpeg" });
  } catch (err) {
    console.error("POST /z/tts error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /z/subscription/checkout ────────────────────────────────────────────
router.post("/z/subscription/checkout", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  try {
    const stripe = await import("stripe").then((m) => new m.default(process.env.STRIPE_SECRET_KEY!));
    const devDomain = process.env.REPLIT_DEV_DOMAIN;
    const baseUrl = devDomain ? `https://${devDomain}/z-tutor` : "http://localhost:5173/z-tutor";

    // Ensure customer
    let [profile] = await db
      .select()
      .from(zStudentProfilesTable)
      .where(eq(zStudentProfilesTable.userId, userId));

    let customerId = profile?.stripeCustomerId ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { zTutorUserId: userId },
      });
      customerId = customer.id;
      if (profile) {
        await db
          .update(zStudentProfilesTable)
          .set({ stripeCustomerId: customerId, updatedAt: new Date() })
          .where(eq(zStudentProfilesTable.userId, userId));
      } else {
        await db.insert(zStudentProfilesTable).values({
          userId,
          plan: "free",
          questionsUsedThisSession: 0,
          questionsUsedThisMonth: 0,
          stripeCustomerId: customerId,
        });
      }
    }

    // Find or create Z Tutor product
    const products = await stripe.products.list({ active: true, limit: 100 });
    let zProduct = products.data.find((p) => p.metadata?.product === "z-tutor");
    if (!zProduct) {
      zProduct = await stripe.products.create({
        name: "Z — Quantivarian AI Tutor",
        description: "Unlimited monthly AI tutoring questions",
        metadata: { product: "z-tutor" },
      });
      await stripe.prices.create({
        product: zProduct.id,
        unit_amount: 999, // $9.99/mo
        currency: "usd",
        recurring: { interval: "month" },
        metadata: { product: "z-tutor" },
      });
    }

    const prices = await stripe.prices.list({ product: zProduct.id, active: true, limit: 10 });
    const price = prices.data.find((p) => p.recurring?.interval === "month");
    if (!price) {
      res.status(500).json({ error: "Z Tutor subscription price not found" });
      return;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: price.id, quantity: 1 }],
      success_url: `${baseUrl}/?subscribed=1`,
      cancel_url: `${baseUrl}/pricing`,
      metadata: { zTutorUserId: userId },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("POST /z/subscription/checkout error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /z/subscription/portal ──────────────────────────────────────────────
router.post("/z/subscription/portal", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  try {
    const [profile] = await db
      .select()
      .from(zStudentProfilesTable)
      .where(eq(zStudentProfilesTable.userId, userId));

    if (!profile?.stripeCustomerId) {
      res.status(400).json({ error: "No active subscription found" });
      return;
    }

    const stripe = await import("stripe").then((m) => new m.default(process.env.STRIPE_SECRET_KEY!));
    const devDomain = process.env.REPLIT_DEV_DOMAIN;
    const returnUrl = devDomain ? `https://${devDomain}/z-tutor/` : "http://localhost:5173/z-tutor/";

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripeCustomerId,
      return_url: returnUrl,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("POST /z/subscription/portal error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /z/admin/users ────────────────────────────────────────────────────────
router.get("/z/admin/users", async (req, res): Promise<void> => {
  const adminId = await requireZAdmin(req, res);
  if (!adminId) return;
  try {
    const profiles = await db
      .select()
      .from(zStudentProfilesTable)
      .orderBy(desc(zStudentProfilesTable.createdAt));
    res.json(profiles);
  } catch (err) {
    console.error("GET /z/admin/users error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /z/admin/users/:userId/quota ───────────────────────────────────────
router.patch("/z/admin/users/:userId/quota", async (req, res): Promise<void> => {
  const adminId = await requireZAdmin(req, res);
  if (!adminId) return;
  try {
    const { userId } = req.params;
    const { plan, monthlyLimit } = req.body as {
      plan?: "free" | "paid";
      monthlyLimit?: number;
    };

    const [profile] = await db
      .select()
      .from(zStudentProfilesTable)
      .where(eq(zStudentProfilesTable.userId, userId));

    if (!profile) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const updates: Partial<typeof zStudentProfilesTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (plan !== undefined) updates.plan = plan;
    if (monthlyLimit !== undefined) updates.monthlyLimit = monthlyLimit;
    if (plan === "paid" && !profile.lastResetAt) {
      updates.lastResetAt = new Date();
    }

    const [updated] = await db
      .update(zStudentProfilesTable)
      .set(updates)
      .where(eq(zStudentProfilesTable.userId, userId))
      .returning();

    res.json(updated);
  } catch (err) {
    console.error("PATCH /z/admin/users/:userId/quota error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
