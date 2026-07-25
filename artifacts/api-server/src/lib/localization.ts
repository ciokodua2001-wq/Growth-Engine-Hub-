import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SlangEntry {
  term: string;
  meaning: string;
  usage: string;
}

export interface LocaleProfile {
  language_name: string;
  regional_nuance: {
    tone: string;
    cultural_values: string[];
    taboos: string[];
    motivators: string[];
  };
  slang_and_idioms: SlangEntry[];
  seo_behavior: {
    search_engine: string;
    keyword_style: string;
    preferred_query_patterns: string[];
    local_signals: string;
    meta_title_style: string;
    meta_description_style: string;
    content_length_preference: string;
  };
  formatting: {
    date_format: string;
    time_format: string;
    currency: string;
    number_separators: string;
    punctuation_style: string;
    address_order: string;
    reading_direction: string;
    preferred_cta_verbs: string[];
    formal_register: string;
  };
}

export type LocaleCode = "es-MX" | "de-DE" | "fr-FR" | "pt-BR";

// ── Profile loader ─────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILES_PATH = resolve(__dirname, "../../config/localizationProfiles.json");

let _cache: Record<string, LocaleProfile> | null = null;

function loadProfiles(): Record<string, LocaleProfile> {
  if (_cache) return _cache;
  const raw = readFileSync(PROFILES_PATH, "utf-8");
  _cache = JSON.parse(raw) as Record<string, LocaleProfile>;
  return _cache;
}

/**
 * Returns the locale profile for the given BCP-47 locale code, or null if the
 * locale is not found in localizationProfiles.json.
 */
export function getLocaleProfile(locale: string): LocaleProfile | null {
  const profiles = loadProfiles();
  return profiles[locale] ?? null;
}

/**
 * Returns all supported locale codes from the profiles file.
 */
export function getSupportedLocales(): string[] {
  return Object.keys(loadProfiles());
}

// ── Copywriting formula overrides per locale ───────────────────────────────────

const COPYWRITING_FORMULA_OVERRIDES: Record<string, string> = {
  "es-MX": `Replace English ad frameworks (AIDA, PAS) with the Mexican copywriting pattern:
  "Conexión familiar → Problema compartido → Solución con orgullo → ¡Ora, actúa!"
  Lead with community or family resonance BEFORE introducing the product. The emotional
  connection must come first; the pitch follows. CTAs should feel like an invitation from
  a trusted friend, not a command from a brand.`,

  "de-DE": `Replace English ad frameworks (AIDA, PAS) with the German decision pattern:
  "Behauptung → Beweis → Messbares Ergebnis → Handlungsaufforderung"
  (Claim → Verifiable Proof → Measurable Result → Call to Action)
  Germans decide with data and logic, not emotional appeals. Lead with a specific,
  provable claim. Back it with a concrete proof point (certification, test result,
  number). State the measurable outcome. Only then invite action. Superlatives without
  proof are lies — omit them entirely.`,

  "fr-FR": `Replace English ad frameworks (AIDA, PAS) with the French persuasion pattern:
  "Observation raffinée → Argument élégant → Bénéfice implicite → Invitation subtile"
  (Refined Observation → Elegant Argument → Implied Benefit → Subtle Invitation)
  French copy makes the reader feel intelligent for recognising the product's value — it
  does not shout at them. The CTA is an invitation, not a command. Wit and understatement
  outperform enthusiasm. Never explain the joke. Never oversell.`,

  "pt-BR": `Replace English ad frameworks (AIDA, PAS) with the Brazilian copy pattern:
  "Conexão → Sonho compartilhado → Solução como caminho → Urgência festiva"
  (Connection → Shared Dream → Solution as Path → Celebratory Urgency)
  Brazilian copy leads with warmth and shared aspiration — the audience must feel seen
  and celebrated before the product appears. Energy and enthusiasm are expected; cold
  professionalism reads as distrust. Always mention parcelamento (instalment options)
  in e-commerce contexts. Urgency should feel like excitement, not pressure.`,
};

const DEFAULT_FORMULA_GUIDANCE = `Apply standard persuasion frameworks appropriate to the content type
  (AIDA for ads, PAS for problem-solution content, storytelling for brand copy).`;

// ── System-level cultural nuance injector ─────────────────────────────────────

/**
 * Injects a strict "Localization Directives" block into an LLM system prompt,
 * upgrading it from a generic content generator into a culturally-native writer
 * for the target market.
 *
 * The injected block instructs the model to:
 * - Rewrite copy natively using regional formulas (NOT line-by-line translation)
 * - Adopt the locale's specific slang, idioms, and tone as mandatory behaviour
 * - Align video scripts and ad hooks to local SEO search-intent patterns
 * - Apply correct formatting (currency, dates, punctuation, register)
 *
 * Falls back to the unmodified basePrompt when localeProfile is null/undefined,
 * ensuring safe degradation to standard professional English.
 *
 * @param basePrompt   The original LLM system message
 * @param localeProfile A LocaleProfile from localizationProfiles.json, or null
 * @returns The system message with the Localization Directives block appended
 */
export function injectCulturalNuance(
  basePrompt: string,
  localeProfile: LocaleProfile | null | undefined,
): string {
  // ── Safe fallback ────────────────────────────────────────────────────────────
  if (!localeProfile) return basePrompt;

  const { language_name, regional_nuance, slang_and_idioms, seo_behavior, formatting } = localeProfile;

  // Find the locale code for formula lookup (match by language_name)
  const formulaKey = Object.keys(COPYWRITING_FORMULA_OVERRIDES).find(
    key => COPYWRITING_FORMULA_OVERRIDES[key] !== undefined &&
           language_name.toLowerCase().includes(key.split("-")[0] === "fr" ? "french"
             : key.split("-")[0] === "de" ? "german"
             : key.split("-")[0] === "pt" ? "portuguese"
             : key.split("-")[0] === "es" ? "spanish" : ""),
  );
  // Fall back to matching by checking locale codes directly
  const localeKey = Object.keys(COPYWRITING_FORMULA_OVERRIDES).find(k =>
    language_name.toLowerCase().startsWith(k.split("-")[0] === "fr" ? "french"
      : k.split("-")[0] === "de" ? "german"
      : k.split("-")[0] === "pt" ? "portuguese"
      : k.split("-")[0] === "es" ? "spanish" : "__none__")
  ) ?? formulaKey;
  const formulaGuidance = (localeKey ? COPYWRITING_FORMULA_OVERRIDES[localeKey] : null)
    ?? DEFAULT_FORMULA_GUIDANCE;

  const slangDirectives = slang_and_idioms
    .map(s => `  • "${s.term}" → ${s.meaning}. Deploy in: ${s.usage}.`)
    .join("\n");

  const directivesBlock = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LOCALIZATION DIRECTIVES — MANDATORY SYSTEM RULES
Target market: ${language_name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RULE 1 — LANGUAGE (non-negotiable)
Write ALL output entirely in ${language_name}. Zero English words except internationally recognised proper nouns and brand names. A bilingual native speaker of ${language_name} must be unable to detect any machine-translated phrasing.

RULE 2 — NATIVE REWRITING (critical)
Do NOT translate English advertising frameworks, copy structures, or persuasion patterns word-for-word. REWRITE everything natively using the rhetorical style, sentence rhythm, and persuasion logic that ${language_name} audiences recognise as authentic.

COPYWRITING FORMULA FOR THIS MARKET:
${formulaGuidance}

RULE 3 — TONE & CULTURAL CALIBRATION (strictly enforce)
${regional_nuance.tone}

Embody these cultural values in every sentence:
${regional_nuance.cultural_values.map(v => `  • ${v}`).join("\n")}

Activate these audience motivators:
${regional_nuance.motivators.map(m => `  • ${m}`).join("\n")}

PROHIBITED patterns (will alienate this audience — treat as hard errors):
${regional_nuance.taboos.map(t => `  ✗ ${t}`).join("\n")}

RULE 4 — SLANG & IDIOMS (mandatory native vocabulary)
You MUST naturally incorporate the expressions below where contextually appropriate. Their complete absence signals foreign copy and breaks trust. Do not force every term into every piece — use judgment, but use them.
${slangDirectives}

RULE 5 — SEO & SEARCH-INTENT ALIGNMENT (video scripts, ad hooks, headlines)
All hooks, opening lines, and headlines must be optimised for how ${language_name} audiences actually search — not for how English-language frameworks describe the product.

- Primary search engine: ${seo_behavior.search_engine}
- Keyword reasoning: ${seo_behavior.keyword_style}
- Align to these high-performing query patterns: ${seo_behavior.preferred_query_patterns.join(" | ")}
- Weave in these local market signals: ${seo_behavior.local_signals}

VIDEO SCRIPT RULE: The first 3 seconds of any video script must open with a hook that directly mirrors one of the search-intent patterns above. The viewer's first thought must be "this is exactly what I was looking for."

AD HOOK RULE: Headlines and opening lines must echo the phrasing patterns users type into ${seo_behavior.search_engine} — not generic English-style benefit statements rephrased in ${language_name}.

Content depth target: ${seo_behavior.content_length_preference}

RULE 6 — FORMATTING (apply precisely)
- Dates: ${formatting.date_format}
- Times: ${formatting.time_format}
- Currency: ${formatting.currency}
- Number formatting: ${formatting.number_separators}
- Punctuation: ${formatting.punctuation_style}
- CTA verbs — use ONLY these, never English equivalents: ${formatting.preferred_cta_verbs.join(", ")}
- Register: ${formatting.formal_register}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
END LOCALIZATION DIRECTIVES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  return `${basePrompt}${directivesBlock}`;
}

// ── Legacy user-prompt renderer (kept for backwards compat) ────────────────────

/**
 * @deprecated Prefer injectCulturalNuance() injected at the system-prompt level.
 * This helper is retained so any external callers don't break during migration.
 */
export function renderLocaleBlock(locale: string | null | undefined): string {
  if (!locale) return "";
  const profile = getLocaleProfile(locale);
  return profile ? `[Locale: ${profile.language_name} — cultural directives applied at system level]` : "";
}
