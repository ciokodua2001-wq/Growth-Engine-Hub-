import { readFileSync } from "fs";
import { resolve } from "path";

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

// process.cwd() is always the workspace root regardless of esbuild bundling —
// import.meta.url resolves to the bundle file in dist/ after compilation,
// making relative paths from __dirname skip past the api-server directory.
const PROFILES_PATH = resolve(process.cwd(), "artifacts/api-server/config/localizationProfiles.json");

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

// ── Unit & currency conversion rules per locale ────────────────────────────────

const UNIT_CONVERSION_RULES: Record<string, string> = {
  "es-MX": `If the source content references USD prices, imperial units, or US-centric measurements,
  convert them automatically using these rules — do NOT leave US-centric figures in the output:
  • USD ($) → Pesos mexicanos (MXN). Format: "$X,XXX MXN" or "MX$X,XXX". Approx rate: $1 USD ≈ $17 MXN.
  • Miles → kilómetros (km). Multiply by 1.609. Example: 60 miles → 97 km.
  • Inches → centímetros (cm). Multiply by 2.54. Example: 6 inches → 15 cm.
  • Feet → metros (m). Multiply by 0.305. Example: 6 ft → 1.83 m.
  • Pounds (weight) → kilogramos (kg). Multiply by 0.453. Example: 10 lbs → 4.5 kg.
  • Fahrenheit → Celsius. Formula: (°F − 32) × 5/9. Example: 72°F → 22°C.
  • Fluid ounces → mililitros (ml). Multiply by 29.57. Example: 8 fl oz → 237 ml.
  • Gallons → litros (L). Multiply by 3.785. Example: 1 gal → 3.8 L.`,

  "de-DE": `If the source content references USD prices, imperial units, or US-centric measurements,
  convert them automatically using these rules — do NOT leave US-centric figures in the output:
  • USD ($) → Euro (€). Format: "X.XXX,XX €" (€ suffix, space before). Approx rate: $1 USD ≈ 0,92 €.
  • Miles → Kilometer (km). Multiply by 1,609. Example: 60 Meilen → 97 km.
  • Inches → Zentimeter (cm). Multiply by 2,54. Example: 6 Zoll → 15,2 cm.
  • Feet → Meter (m). Multiply by 0,305. Example: 6 Fuß → 1,83 m.
  • Pounds (weight) → Kilogramm (kg). Multiply by 0,453. Example: 10 lbs → 4,5 kg.
  • Fahrenheit → Celsius. Formel: (°F − 32) × 5/9. Example: 72°F → 22°C.
  • Fluid ounces → Milliliter (ml). Multiply by 29,57. Example: 8 fl oz → 237 ml.
  • Gallons → Liter (L). Multiply by 3,785. Example: 1 Gallon → 3,8 L.`,

  "fr-FR": `If the source content references USD prices, imperial units, or US-centric measurements,
  convert them automatically using these rules — do NOT leave US-centric figures in the output:
  • USD ($) → Euro (€). Format: "X XXX,XX €" (€ suffix, non-breaking space before). Approx rate: $1 USD ≈ 0,92 €.
  • Miles → kilomètres (km). Multiply by 1,609. Example: 60 miles → 97 km.
  • Inches → centimètres (cm). Multiply by 2,54. Example: 6 pouces → 15,2 cm.
  • Feet → mètres (m). Multiply by 0,305. Example: 6 pieds → 1,83 m.
  • Pounds (weight) → kilogrammes (kg). Multiply by 0,453. Example: 10 lbs → 4,5 kg.
  • Fahrenheit → Celsius. Formule : (°F − 32) × 5/9. Example : 72°F → 22°C.
  • Fluid ounces → millilitres (ml). Multiply by 29,57. Example : 8 fl oz → 237 ml.
  • Gallons → litres (L). Multiply by 3,785. Example : 1 gallon → 3,8 L.`,

  "pt-BR": `If the source content references USD prices, imperial units, or US-centric measurements,
  convert them automatically using these rules — do NOT leave US-centric figures in the output:
  • USD ($) → Reais brasileiros (R$). Format: "R$ X.XXX,XX". Approx rate: $1 USD ≈ R$ 5,00.
    Always add parcelamento framing for any price above R$ 100: "ou Xx de R$ XX,XX sem juros".
  • Miles → quilômetros (km). Multiply by 1,609. Example: 60 milhas → 97 km.
  • Inches → centímetros (cm). Multiply by 2,54. Example: 6 polegadas → 15 cm.
  • Feet → metros (m). Multiply by 0,305. Example: 6 pés → 1,83 m.
  • Pounds (weight) → quilogramas (kg). Multiply by 0,453. Example: 10 lbs → 4,5 kg.
  • Fahrenheit → Celsius. Fórmula: (°F − 32) × 5/9. Example: 72°F → 22°C.
  • Fluid ounces → mililitros (ml). Multiply by 29,57. Example: 8 fl oz → 237 ml.
  • Gallons → litros (L). Multiply by 3,785. Example: 1 galão → 3,8 L.`,
};

// ── System-level cultural nuance injector ─────────────────────────────────────

/**
 * Injects a strict "Localization Directives" block into an LLM system prompt,
 * upgrading it from a generic content generator into a culturally-native writer
 * for the target market.
 *
 * Rules injected:
 *  1. Language — 100% target language, no leakage
 *  2. Native rewriting — no line-by-line translation; regional copywriting formulas
 *  3. Tone & cultural calibration — values, motivators, prohibited patterns
 *  4. Slang & idioms — mandatory native vocabulary
 *  5. SEO & search-intent alignment — hooks wired to local query patterns
 *  6. Formatting — currency, dates, numbers, punctuation, register
 *  7. Output purity — no conversational filler, no preambles, pure JSON
 *  8. Markdown preservation — structural tokens must survive inside JSON strings
 *  9. Unit & currency conversion — US-centric figures auto-converted to local equivalents
 *
 * Falls back to the unmodified basePrompt when localeProfile is null/undefined,
 * ensuring safe degradation to standard professional English.
 *
 * @param basePrompt    The original LLM system message
 * @param localeProfile A LocaleProfile from localizationProfiles.json, or null
 * @param localeCode    BCP-47 locale code (e.g. "es-MX") — used for exact table lookups
 * @returns The enriched system message
 */
export function injectCulturalNuance(
  basePrompt: string,
  localeProfile: LocaleProfile | null | undefined,
  localeCode?: string,
): string {
  // ── Safe fallback — English or unknown locale ────────────────────────────────
  if (!localeProfile) return basePrompt;

  const { language_name, regional_nuance, slang_and_idioms, seo_behavior, formatting } = localeProfile;

  // Use the explicit localeCode for exact table lookups; no fragile string matching.
  const formulaGuidance = (localeCode ? COPYWRITING_FORMULA_OVERRIDES[localeCode] : null)
    ?? DEFAULT_FORMULA_GUIDANCE;

  const unitConversionRules = (localeCode ? UNIT_CONVERSION_RULES[localeCode] : null)
    ?? "Use the metric system and local currency throughout. Convert any US-centric figures encountered.";

  const slangDirectives = slang_and_idioms
    .map(s => `  • "${s.term}" → ${s.meaning}. Deploy in: ${s.usage}.`)
    .join("\n");

  const directivesBlock = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LOCALIZATION DIRECTIVES — MANDATORY SYSTEM RULES
Target market: ${language_name}${localeCode ? ` (${localeCode})` : ""}
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
Naturally incorporate the expressions below where contextually appropriate. Their complete absence signals foreign copy and breaks trust. Use judgment — do not force every term, but use them.
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

RULE 7 — OUTPUT PURITY (zero tolerance)
Your response is consumed directly by an automated pipeline. Any of the following will break the system and are strictly forbidden:
  ✗ Conversational preambles: "Here is your copy:", "Here's the translation:", "Sure, I've written:", "Of course,", "Certainly,", "As requested,"
  ✗ Sign-offs or closing remarks: "I hope this helps", "Let me know if you need changes", "Feel free to adjust"
  ✗ Meta-commentary: "Note that I used informal tone because...", "I translated this as...", "This copy follows..."
  ✗ Language-mixing: English phrases embedded inside ${language_name} copy (except proper nouns)
  ✗ Apologies or hedging: "I'm not sure if this is correct but...", "You may want to verify..."
Output ONLY the raw JSON object requested. Nothing before the opening brace. Nothing after the closing brace.

RULE 8 — MARKDOWN STRUCTURE PRESERVATION
Many output fields contain markdown formatting (##, ###, **, *, -, numbered lists). These structural tokens carry semantic meaning and must be preserved exactly:
  • ## and ### headings must remain as-is — do not convert to plain text or bold
  • **bold** markers must remain paired — never leave a dangling **
  • Bullet lists (- item) and numbered lists (1. item) must maintain their prefix characters
  • Do not add or remove blank lines inside markdown blocks — preserve the structure the schema specifies
  • JSON string escaping: use \\n for newlines inside JSON string values, never literal line breaks
  • Never wrap the JSON in markdown fences (\`\`\`json ... \`\`\`)

RULE 9 — UNIT & CURRENCY CONVERSION (automatic, no exceptions)
${unitConversionRules}
  If the exact conversion rate is unknown at generation time, use the approximate rate provided and flag with "(aprox.)" — never leave raw USD, miles, inches, or °F in the final output.

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
