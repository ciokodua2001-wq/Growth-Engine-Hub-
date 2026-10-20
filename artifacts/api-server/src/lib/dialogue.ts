// ── Script fidelity & dialogue-preservation helpers ──────────────────────────
// Single source of truth for the "captions must match actual audio" and
// "customers own their approved dialogue" product principles. Everything here
// is deterministic (cheap) except transcribeAudioWithGemini, which uses the
// EXISTING Gemini Developer API key (no new provider) to transcribe actual
// assembled audio - the authoritative speech source for captions and fidelity.

export interface TranscriptSegment {
  text: string;
  startSec?: number;
  endSec?: number;
  confidence?: number; // 0-1, optional; Gemini transcription is approximate
}

export type FidelityStatus = "unverified" | "matches" | "difference";

export interface FidelityDifference {
  type: "missing" | "added" | "substituted" | "material";
  approved?: string;
  spoken?: string;
  note?: string;
}

export interface FidelityReport {
  status: FidelityStatus;
  similarity: number; // 0-1
  approvedWordCount: number;
  transcriptWordCount: number;
  differences: FidelityDifference[];
  checkedAt: string;
}

// ── Dialogue extraction (verbatim, no AI rewriting) ──────────────────────────

interface CinematicPlanShape {
  shots?: Array<{ dialogue?: string; duration?: number }>;
}

/**
 * Returns the exact customer-approved dialogue as a list of spoken lines.
 * Prefers the cinematicPlan shot list (which carries per-shot dialogue); falls
 * back to splitting the continuous `script` into sentences. Never rewrites.
 */
export function extractDialogueLines(script: string | null, cinematicPlan: string | null): string[] {
  if (cinematicPlan) {
    try {
      const plan = JSON.parse(cinematicPlan) as CinematicPlanShape;
      const lines = (plan.shots ?? [])
        .map(s => (s.dialogue ?? "").trim())
        .filter(Boolean);
      if (lines.length > 0) return lines;
    } catch {
      // fall through to script splitting
    }
  }
  return splitSentences(script ?? "");
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim().replace(/^[""]|[""]$/g, ""))
    .filter(Boolean);
}

/**
 * Distributes dialogue lines across `sceneCount` scenes, preserving the exact
 * wording. Adjacent lines are joined with a single space when there are more
 * lines than scenes; scenes with no assigned line get an empty string (silent
 * hero/transition shots). This is what makes Veo's native audio speak the
 * customer's approved words instead of an AI paraphrase.
 */
export function distributeDialogue(lines: string[], sceneCount: number): string[] {
  const n = Math.max(1, sceneCount);
  if (lines.length === 0) return new Array(n).fill("");
  const out: string[] = [];
  const per = Math.ceil(lines.length / n);
  for (let i = 0; i < n; i++) {
    out.push(lines.slice(i * per, (i + 1) * per).join(" "));
  }
  return out;
}

// ── Dialogue-fit estimate (Phase E, deterministic) ───────────────────────────

const WORDS_PER_SECOND = 2.6; // natural conversational pace incl. pauses

export interface DialogueFitResult {
  fits: boolean;
  wordCount: number;
  speakingBudgetSec: number;
  estimatedSpeakingSec: number;
  reason: string | null;
  suggestedDurationSec: number | null;
}

/**
 * Lightweight deterministic check that the approved dialogue can plausibly fit
 * the requested duration before any paid generation. Assumes ~15% of the
 * runtime is visual-only (hero/transition shots) and no silent re-take.
 */
export function estimateDialogueFit(script: string, durationSec: number): DialogueFitResult {
  const wordCount = script.trim().split(/\s+/).filter(Boolean).length;
  const speakingBudgetSec = Math.max(0, durationSec * 0.85);
  const estimatedSpeakingSec = wordCount / WORDS_PER_SECOND;
  const fits = estimatedSpeakingSec <= speakingBudgetSec;
  const suggestedDurationSec = fits
    ? null
    : Math.ceil((estimatedSpeakingSec / 0.85) / 5) * 5;
  const reason = fits
    ? null
    : `Script is ~${estimatedSpeakingSec.toFixed(1)}s of speech but the ${durationSec}s format allows ~${speakingBudgetSec.toFixed(1)}s.`;
  return { fits, wordCount, speakingBudgetSec, estimatedSpeakingSec, reason, suggestedDurationSec };
}

// ── Script-vs-transcript fidelity (Phase G, deterministic) ───────────────────

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/["""''']/g, "")
    .replace(/[^a-z0-9\s$%.,!?]/g, " ")
    .split(/\s+/)
    .map(w => w.replace(/^[^a-z0-9$]+|[^a-z0-9$%]+$/g, ""))
    .filter(Boolean);
}

const MATERIAL_RE = /(\$?\d[\d.,]*%?|free|guarantee|warranty|official|no\s+\d+|price)/i;

/**
 * Compares the actual-audio transcript against the approved script. Never
 * rewrites anything - it only detects missing / added / substituted words and
 * flags material tokens (prices, numbers, claims) especially loudly.
 */
export function compareScriptToTranscript(approvedScript: string, transcript: string): FidelityReport {
  const approved = normalize(approvedScript);
  const spoken = normalize(transcript);

  const approvedSet = new Set(approved);
  const spokenSet = new Set(spoken);

  const missing = approved.filter(w => !spokenSet.has(w));
  const added = spoken.filter(w => !approvedSet.has(w));

  const intersection = approved.filter(w => spokenSet.has(w)).length;
  const union = new Set([...approved, ...spoken]).size;
  const similarity = union === 0 ? 1 : intersection / union;

  const differences: FidelityDifference[] = [];
  for (const w of missing) differences.push({ type: "missing", approved: w });
  for (const w of added) differences.push({ type: "added", spoken: w });

  // Material tokens get their own, louder signal (prices/numbers/claims).
  for (const w of approved) {
    if (MATERIAL_RE.test(w) && !spokenSet.has(w)) {
      differences.push({ type: "material", approved: w, note: "Price/claim/number present in approved script but not in audio" });
    }
  }
  for (const w of spoken) {
    if (MATERIAL_RE.test(w) && !approvedSet.has(w)) {
      differences.push({ type: "material", spoken: w, note: "Price/claim/number spoken but not in approved script" });
    }
  }

  const status: FidelityStatus = similarity >= 0.95 && missing.length === 0 && added.length === 0
    ? "matches"
    : "difference";

  return {
    status,
    similarity: Math.round(similarity * 1000) / 1000,
    approvedWordCount: approved.length,
    transcriptWordCount: spoken.length,
    differences: differences.slice(0, 200),
    checkedAt: new Date().toISOString(),
  };
}

// ── Actual-audio transcription (Phase F, existing Gemini key) ────────────────
// Gemini Developer API transcribes audio but does NOT provide reliable
// word-level timestamps - output is phrase/sentence-level. Documented honestly:
// captions use these phrase-level timings; word-level alignment would need a
// dedicated STT provider (not introduced without approval).

const TRANSCRIBE_MODEL = "gemini-3.1-flash-lite";
const MAX_AUDIO_BYTES = 9_500_000; // keep inline payload within API limits

export async function transcribeAudioWithGemini(
  audioBase64: string,
  mimeType: string,
  languageHint?: string,
): Promise<string> {
  if (audioBase64.length > MAX_AUDIO_BYTES) {
    throw new Error("Audio too large to transcribe inline");
  }
  const instruction =
    `Transcribe ONLY the spoken dialogue in this audio. Return the verbatim words the speaker says, ` +
    `with natural punctuation and line breaks where the speaker pauses. ` +
    `Do not describe music, sounds, or silence. Do not translate - keep the original language. ` +
    `If a word is unclear, mark it with [unclear]. Do not add words that were not spoken.` +
    (languageHint ? ` The expected language is ${languageHint}.` : "");

  const { genai } = await import("@workspace/integrations-google-genai");
  const response = await genai.models.generateContent({
    model: TRANSCRIBE_MODEL,
    contents: [
      { inlineData: { mimeType, data: audioBase64 } },
      { text: instruction },
    ],
  });

  return (response.text ?? "").trim();
}
