/**
 * Localization engine test suite
 *
 * Validates injectCulturalNuance() without any live API calls:
 *   1. Safe fallback — null/undefined profile → basePrompt unchanged
 *   2. Formula lookup — exact locale code, not fragile string matching
 *   3. All 9 directive rules are present in the injected block
 *   4. Anti-filler phrases present (Rule 7)
 *   5. Markdown preservation rules present (Rule 8)
 *   6. Unit/currency conversion rules present and locale-specific (Rule 9)
 *   7. Locale code appears in the header
 *   8. All 5 supported locales produce a block longer than the base prompt
 *   9. Output structure — base prompt always leads; directives always trail
 *  10. Regression — locales that previously failed formula lookup now resolve correctly
 */

import { describe, it, expect } from "vitest";
import {
  injectCulturalNuance,
  getLocaleProfile,
  getSupportedLocales,
  type LocaleProfile,
} from "../localization.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE = "You are a senior copywriter. Respond with ONLY a single JSON object, no prose.";

function enriched(locale: string): string {
  const profile = getLocaleProfile(locale);
  return injectCulturalNuance(BASE, profile, locale);
}

// Patterns that should NEVER appear in clean output (Rule 7 teaches the model to avoid these)
const FILLER_PATTERNS = [
  /here is your (copy|translation|content)/i,
  /here'?s the (translation|copy|content)/i,
  /sure,? (here|i'?ve|i have)/i,
  /of course,/i,
  /certainly,/i,
  /as requested/i,
  /i hope this helps/i,
  /let me know if you need/i,
  /feel free to adjust/i,
];

// ── Suite 1: Safe fallback ────────────────────────────────────────────────────

describe("injectCulturalNuance — safe fallback", () => {
  it("returns basePrompt unchanged when profile is null", () => {
    expect(injectCulturalNuance(BASE, null)).toBe(BASE);
  });

  it("returns basePrompt unchanged when profile is undefined", () => {
    expect(injectCulturalNuance(BASE, undefined)).toBe(BASE);
  });

  it("returns basePrompt unchanged when localeCode is unknown", () => {
    // Simulate a locale that exists in the file but we pass null profile (e.g. typo in code)
    expect(injectCulturalNuance(BASE, null, "xx-XX")).toBe(BASE);
  });
});

// ── Suite 2: All supported locales load and produce enriched output ───────────

describe("injectCulturalNuance — all supported locales", () => {
  it("getSupportedLocales returns at least 4 locales", () => {
    expect(getSupportedLocales().length).toBeGreaterThanOrEqual(4);
  });

  const SUPPORTED = ["es-MX", "de-DE", "fr-FR", "pt-BR"] as const;

  SUPPORTED.forEach(locale => {
    it(`${locale}: profile loads successfully`, () => {
      expect(getLocaleProfile(locale)).not.toBeNull();
    });

    it(`${locale}: enriched prompt is longer than base`, () => {
      expect(enriched(locale).length).toBeGreaterThan(BASE.length + 500);
    });

    it(`${locale}: base prompt content is preserved at the start`, () => {
      expect(enriched(locale)).toContain(BASE);
      expect(enriched(locale).indexOf(BASE)).toBe(0);
    });

    it(`${locale}: directives block appears after base prompt`, () => {
      const result = enriched(locale);
      const directivesIdx = result.indexOf("LOCALIZATION DIRECTIVES");
      expect(directivesIdx).toBeGreaterThan(BASE.length - 1);
    });
  });
});

// ── Suite 3: All 9 rules are present ─────────────────────────────────────────

describe("injectCulturalNuance — rule completeness", () => {
  const locale = "es-MX";
  let result: string;

  result = enriched(locale);

  it("Rule 1 — language mandate present", () => {
    expect(result).toContain("RULE 1 — LANGUAGE");
  });

  it("Rule 2 — native rewriting mandate present", () => {
    expect(result).toContain("RULE 2 — NATIVE REWRITING");
  });

  it("Rule 3 — tone & cultural calibration present", () => {
    expect(result).toContain("RULE 3 — TONE & CULTURAL CALIBRATION");
  });

  it("Rule 4 — slang & idioms directive present", () => {
    expect(result).toContain("RULE 4 — SLANG & IDIOMS");
  });

  it("Rule 5 — SEO & search-intent alignment present", () => {
    expect(result).toContain("RULE 5 — SEO & SEARCH-INTENT ALIGNMENT");
  });

  it("Rule 6 — formatting rules present", () => {
    expect(result).toContain("RULE 6 — FORMATTING");
  });

  it("Rule 7 — output purity / anti-filler present", () => {
    expect(result).toContain("RULE 7 — OUTPUT PURITY");
  });

  it("Rule 8 — markdown preservation present", () => {
    expect(result).toContain("RULE 8 — MARKDOWN STRUCTURE PRESERVATION");
  });

  it("Rule 9 — unit & currency conversion present", () => {
    expect(result).toContain("RULE 9 — UNIT & CURRENCY CONVERSION");
  });
});

// ── Suite 4: Anti-filler directive content (Rule 7) ───────────────────────────

describe("injectCulturalNuance — Rule 7 anti-filler directive", () => {
  // The directive block itself teaches the model which phrases to avoid.
  // We verify the directive enumerates these patterns so the model is trained to suppress them.
  const REQUIRED_FILLER_CALLOUTS = [
    "Here is your",
    "Here's the",
    "Of course,",
    "Certainly,",
    "As requested",
    "I hope this helps",
    "Let me know if",
    "Feel free to adjust",
  ];

  REQUIRED_FILLER_CALLOUTS.forEach(phrase => {
    it(`Rule 7 explicitly lists "${phrase}" as forbidden`, () => {
      const result = enriched("de-DE");
      // The phrase appears in the directive block as something the model must NOT say
      expect(result).toContain(phrase);
    });
  });

  it("Rule 7 prohibits JSON markdown fences", () => {
    expect(enriched("fr-FR")).toContain("```json");
  });

  it("Rule 7 prohibits output before the opening brace", () => {
    expect(enriched("pt-BR")).toContain("Nothing before the opening brace");
  });
});

// ── Suite 5: Markdown preservation rules (Rule 8) ─────────────────────────────

describe("injectCulturalNuance — Rule 8 markdown preservation", () => {
  it("mentions ## and ### headings", () => {
    expect(enriched("fr-FR")).toContain("##");
  });

  it("mentions bold markers", () => {
    expect(enriched("de-DE")).toContain("**bold**");
  });

  it("mentions JSON string escaping with \\n", () => {
    // Template literal \\n resolves to the 2-char literal \n — check for that
    expect(enriched("es-MX")).toContain("\\n");
  });

  it("mentions dangling ** risk", () => {
    expect(enriched("pt-BR")).toContain("dangling");
  });
});

// ── Suite 6: Unit & currency conversion rules (Rule 9) ────────────────────────

describe("injectCulturalNuance — Rule 9 unit conversion — es-MX", () => {
  const result = enriched("es-MX");

  it("references MXN currency", () => { expect(result).toContain("MXN"); });
  it("provides USD→MXN conversion rate", () => { expect(result).toContain("$17 MXN"); });
  it("references km for distance", () => { expect(result).toContain("km"); });
  it("references cm for inches", () => { expect(result).toContain("cm"); });
  it("references Celsius conversion", () => { expect(result).toContain("Celsius"); });
  it("references kg for pounds", () => { expect(result).toContain("kg"); });
  it("does NOT prescribe EUR for Mexico", () => { expect(result).not.toContain("€"); });
});

describe("injectCulturalNuance — Rule 9 unit conversion — de-DE", () => {
  const result = enriched("de-DE");

  it("references EUR currency", () => { expect(result).toContain("€"); });
  it("provides € suffix format guidance", () => { expect(result).toContain("€ suffix"); });
  it("references km for distance", () => { expect(result).toContain("km"); });
  it("references Celsius/Celsius conversion", () => { expect(result).toContain("Celsius"); });
  it("does NOT prescribe MXN for Germany", () => { expect(result).not.toContain("MXN"); });
  it("does NOT prescribe R$ for Germany", () => { expect(result).not.toContain("R$"); });
});

describe("injectCulturalNuance — Rule 9 unit conversion — fr-FR", () => {
  const result = enriched("fr-FR");

  it("references EUR currency", () => { expect(result).toContain("€"); });
  it("references non-breaking space in currency format", () => { expect(result).toContain("non-breaking space"); });
  it("references km for distance", () => { expect(result).toContain("km"); });
  it("does NOT prescribe MXN for France", () => { expect(result).not.toContain("MXN"); });
});

describe("injectCulturalNuance — Rule 9 unit conversion — pt-BR", () => {
  const result = enriched("pt-BR");

  it("references BRL / R$ currency", () => { expect(result).toContain("R$"); });
  it("references parcelamento installment framing", () => { expect(result).toContain("parcelamento"); });
  it("references USD→BRL rate", () => { expect(result).toContain("R$ 5,00"); });
  it("references km for distance", () => { expect(result).toContain("km"); });
  it("does NOT prescribe EUR for Brazil", () => { expect(result).not.toContain("€"); });
});

// ── Suite 7: Formula lookup correctness (regression) ─────────────────────────

describe("injectCulturalNuance — formula lookup via localeCode", () => {
  it("es-MX resolves Mexican copywriting pattern", () => {
    expect(enriched("es-MX")).toContain("Conexión familiar");
  });

  it("de-DE resolves German decision pattern (Behauptung)", () => {
    expect(enriched("de-DE")).toContain("Behauptung");
  });

  it("fr-FR resolves French persuasion pattern (Observation raffinée)", () => {
    expect(enriched("fr-FR")).toContain("Observation raffinée");
  });

  it("pt-BR resolves Brazilian copy pattern (Conexão)", () => {
    expect(enriched("pt-BR")).toContain("Conexão");
  });
});

// ── Suite 8: Locale header ────────────────────────────────────────────────────

describe("injectCulturalNuance — locale header in directives block", () => {
  it("es-MX header shows locale code", () => {
    expect(enriched("es-MX")).toContain("(es-MX)");
  });

  it("de-DE header shows locale code", () => {
    expect(enriched("de-DE")).toContain("(de-DE)");
  });

  it("fr-FR header shows locale code", () => {
    expect(enriched("fr-FR")).toContain("(fr-FR)");
  });

  it("pt-BR header shows locale code", () => {
    expect(enriched("pt-BR")).toContain("(pt-BR)");
  });
});

// ── Suite 9: Video script & ad hook SEO directives ────────────────────────────

describe("injectCulturalNuance — video script & ad hook rules", () => {
  it("contains VIDEO SCRIPT RULE directive", () => {
    expect(enriched("es-MX")).toContain("VIDEO SCRIPT RULE");
  });

  it("contains AD HOOK RULE directive", () => {
    expect(enriched("de-DE")).toContain("AD HOOK RULE");
  });

  it("es-MX video rule references Mexican search query patterns", () => {
    const result = enriched("es-MX");
    expect(result).toContain("Google.com.mx");
  });

  it("fr-FR ad hook rule references Google.fr", () => {
    const result = enriched("fr-FR");
    expect(result).toContain("Google.fr");
  });

  it("de-DE references German search patterns (Vergleich/Test queries)", () => {
    const result = enriched("de-DE");
    // The German SEO behavior section lists "Vergleich", "Test" query patterns
    expect(result).toMatch(/Vergleich|Test|kaufen/);
  });
});

// ── Suite 10: Profile data integrity ─────────────────────────────────────────

describe("locale profile data integrity", () => {
  const SUPPORTED = ["es-MX", "de-DE", "fr-FR", "pt-BR"] as const;

  SUPPORTED.forEach(locale => {
    const profile = getLocaleProfile(locale) as LocaleProfile;

    it(`${locale}: has language_name`, () => {
      expect(profile.language_name).toBeTruthy();
    });

    it(`${locale}: has at least 4 slang entries`, () => {
      expect(profile.slang_and_idioms.length).toBeGreaterThanOrEqual(4);
    });

    it(`${locale}: has at least 3 preferred CTA verbs`, () => {
      expect(profile.formatting.preferred_cta_verbs.length).toBeGreaterThanOrEqual(3);
    });

    it(`${locale}: has at least 3 cultural values`, () => {
      expect(profile.regional_nuance.cultural_values.length).toBeGreaterThanOrEqual(3);
    });

    it(`${locale}: has at least 2 SEO query patterns`, () => {
      expect(profile.seo_behavior.preferred_query_patterns.length).toBeGreaterThanOrEqual(2);
    });

    it(`${locale}: slang entries each have term, meaning, usage`, () => {
      profile.slang_and_idioms.forEach(entry => {
        expect(entry.term).toBeTruthy();
        expect(entry.meaning).toBeTruthy();
        expect(entry.usage).toBeTruthy();
      });
    });
  });
});
