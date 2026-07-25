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

export type LocaleCode = "es-MX" | "de-DE" | "pt-BR";

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

// ── Prompt block renderer ──────────────────────────────────────────────────────

/**
 * Renders a locale profile into a structured prompt block that can be injected
 * into any LLM system prompt or user prompt. Returns an empty string when no
 * profile is found so callers can safely concatenate without branching.
 */
export function renderLocaleBlock(locale: string | null | undefined): string {
  if (!locale) return "";

  const profile = getLocaleProfile(locale);
  if (!profile) return "";

  const { language_name, regional_nuance, slang_and_idioms, seo_behavior, formatting } = profile;

  const slangList = slang_and_idioms
    .map(s => `  • "${s.term}" — ${s.meaning} (use in: ${s.usage})`)
    .join("\n");

  const ctaVerbs = formatting.preferred_cta_verbs.join(", ");

  return `
━━━ LOCALIZATION PROFILE: ${language_name} (${locale}) ━━━

REGIONAL TONE & NUANCE
${regional_nuance.tone}
Cultural values to reflect: ${regional_nuance.cultural_values.join("; ")}.
Key motivators for this audience: ${regional_nuance.motivators.join("; ")}.
AVOID: ${regional_nuance.taboos.join("; ")}.

APPROVED SLANG & IDIOMS (use naturally where appropriate)
${slangList}

SEO BEHAVIOR
- Primary search engine: ${seo_behavior.search_engine}
- Keyword style: ${seo_behavior.keyword_style}
- High-performing query patterns: ${seo_behavior.preferred_query_patterns.join(", ")}
- Local signals to include: ${seo_behavior.local_signals}
- Meta title guidance: ${seo_behavior.meta_title_style}
- Meta description guidance: ${seo_behavior.meta_description_style}
- Content length preference: ${seo_behavior.content_length_preference}

FORMATTING RULES
- Date: ${formatting.date_format} | Time: ${formatting.time_format}
- Currency: ${formatting.currency} | Numbers: ${formatting.number_separators}
- Punctuation: ${formatting.punctuation_style}
- Preferred CTA verbs (use these instead of English defaults): ${ctaVerbs}
- Register: ${formatting.formal_register}

INSTRUCTION: Generate ALL output text in ${language_name}. Apply every rule above. Do not mix languages.
━━━`.trim();
}
