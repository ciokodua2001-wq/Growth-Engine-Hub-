import { generateJson } from "./aiJson.js";
import { renderGroundingBlock, type GroundingContext } from "./projectContext.js";
import { renderLocaleBlock } from "./localization.js";

export interface SocialPostResult {
  platform: string;
  caption: string;
  hashtags: string;
  cta: string;
}

export async function generateSocialPosts(
  ctx: GroundingContext,
  opts: { platforms: string[]; perPlatform: number; prompt?: string; locale?: string },
): Promise<SocialPostResult[]> {
  const requestedTotal = opts.platforms.length * opts.perPlatform;
  const localeBlock = renderLocaleBlock(opts.locale);
  const response = await generateJson<{ posts: SocialPostResult[] }>({
    system:
      "You are a senior social media copywriter. You write specific, on-brand social posts grounded in the " +
      "real business context provided — never generic marketing filler, never posts about the platform " +
      "itself. Respond with ONLY a single JSON object, no prose.",
    prompt: `${renderGroundingBlock(ctx)}
${localeBlock ? `\n${localeBlock}\n` : ""}
${opts.prompt ? `\nAdditional direction from the user: ${opts.prompt}\n` : ""}
Write exactly ${opts.perPlatform} social post(s) for EACH of these platforms: ${opts.platforms.join(", ")}.
Each post must be tailored to that platform's tone/format and to THIS business's audience, voice, and value
proposition. Return JSON:
{
  "posts": [
    { "platform": "one of: ${opts.platforms.join(", ")}", "caption": "the post copy", "hashtags": "space-separated hashtags relevant to this business, or empty string", "cta": "a short call to action, or empty string" }
  ]
}
The "posts" array must contain exactly ${requestedTotal} items (${opts.perPlatform} per platform).`,
  });
  return response.posts.slice(0, requestedTotal);
}

export interface EmailResult {
  subject: string;
  previewText: string;
  body: string;
}

const EMAIL_TYPE_BRIEFS: Record<string, string> = {
  welcome: "a welcome email for a brand-new customer/lead, onboarding them and building excitement about the value they'll get",
  sales: "a sales-focused email making the case for why the prospect should buy, using concrete value/ROI reasoning",
  nurture: "a nurture email that builds trust and authority without a hard sell, teaching the reader something valuable",
  reactivation: "a win-back/reactivation email for a lapsed or inactive customer, re-engaging them with what's new or valuable",
};

export async function generateEmailCampaign(
  ctx: GroundingContext,
  opts: { type: string; subjectHint?: string; prompt?: string; locale?: string },
): Promise<EmailResult> {
  const localeBlock = renderLocaleBlock(opts.locale);
  return generateJson<EmailResult>({
    system:
      "You are a senior email marketing copywriter. You write specific, on-brand marketing emails grounded " +
      "in the real business context provided — never generic filler, never an email about the platform " +
      "itself. Use {{first_name}} as the recipient placeholder. Respond with ONLY a single JSON object, no prose.",
    prompt: `${renderGroundingBlock(ctx)}
${localeBlock ? `\n${localeBlock}\n` : ""}
${opts.subjectHint ? `\nRequested subject line direction: ${opts.subjectHint}\n` : ""}
${opts.prompt ? `\nAdditional direction from the user: ${opts.prompt}\n` : ""}
Write ${EMAIL_TYPE_BRIEFS[opts.type] ?? EMAIL_TYPE_BRIEFS.welcome} for this specific business. Return JSON:
{
  "subject": "a compelling subject line specific to this business",
  "previewText": "a short preview/preheader line",
  "body": "the full email body, using {{first_name}} as the greeting placeholder, with real paragraphs and a clear CTA"
}`,
  });
}

export interface CinematicShot {
  shotNumber: number;
  duration: number;
  environment: string;
  subjectAction: string;
  facialExpression: string;
  bodyMovement: string;
  cameraMovement: string;
  lensStyle: string;
  lighting: string;
  visualEffects: string;
  transition: string;
  dialogue: string; // exact words actor speaks in this shot (empty string if silent)
}

export interface CinematicPlan {
  visualStyle: string;
  characterDescription: string;
  environment: string;
  lighting: string;
  cameraLanguage: string;
  performanceDirection: string;
  shots: CinematicShot[];
  textOverlayPlacement: string;
  finalHeroShot: string;
}

export interface VideoBlueprintResult {
  title: string;
  type: string;
  script: string;
  storyboard: string;
  cinematicPlan: string; // JSON-serialised CinematicPlan
  duration: number;
  hookStrength: number;
  engagementPotential: number;
  viralPotential: number;
}

const AI_VIDEO_DIRECTOR_SYSTEM = `You are a world-class screenwriter and commercial film director. You write ACTOR PERFORMANCE SCRIPTS — dialogue spoken BY a character directly to camera, not narration about them.

The script and shot list you produce will be performed by a real AI actor with accurate lip sync. Every word must sound like a real human speaking conversationally — not a commercial announcer, not a documentary narrator.

SCRIPT RULES
- Write in FIRST PERSON as the character speaking directly to the viewer ("you", "your", "I", "we")
- NO scene labels, NO beat markers, NO stage directions anywhere in the script field ([HOOK], [SCENE 1], etc. are FORBIDDEN)
- NO narration phrases ("here we see...", "in this scene...", "let me show you...")
- Natural, conversational speech: short sentences, contractions, direct questions, direct address
- The full script is ONE continuous performance delivered start to finish by the actor

PER-SHOT DIALOGUE
Each shot must include the EXACT WORDS the actor speaks during that shot. The lip-sync engine uses these words at the frame level. Shots where the actor is silent (establishing shots, reaction beats, transition moments) must have an empty dialogue string "".

WORD COUNT GUIDELINES (match script length to requested duration)
15s → ~35–40 words | 30s → ~70–80 words | 45s → ~105–120 words | 60s → ~140–160 words | 90s → ~210–230 words | 120s → ~280–310 words

CINEMATIC DIRECTION
Think like: Director + Cinematographer + Commercial Producer + Creative Agency.
Every shot must feel filmed by a real production crew — real locations, real lighting, real motion, real performance.
Output should resemble: Kling-quality, Higgsfield-quality, Runway-quality productions. Luxury commercial advertisements.

CHARACTER CONSISTENCY
If an avatar or character is described, preserve their look across every shot: face structure, hair, skin, clothing, distinguishing features. Identity consistency is mandatory.

Respond with ONLY a single JSON object, no prose.`;

async function generateSingleVideoBlueprint(
  ctx: GroundingContext,
  opts: { type?: string; prompt?: string; index: number; total: number; targetDuration?: number; locale?: string },
): Promise<VideoBlueprintResult> {
  // Generate exactly ONE video per call to guarantee the JSON response stays
  // well within the 8192-token output limit regardless of how verbose Claude is.
  const typeHint = opts.type ? `, of type "${opts.type}"` : (
    opts.index % 3 === 0 ? ', of type "promo"' :
    opts.index % 3 === 1 ? ', of type "product"' :
                           ', of type "social"'
  );
  const durationTarget = opts.targetDuration ?? 45;
  const localeBlock = renderLocaleBlock(opts.locale);
  const response = await generateJson<{ videos: [Omit<VideoBlueprintResult, "cinematicPlan"> & { cinematicPlan: CinematicPlan }] }>({
    system: AI_VIDEO_DIRECTOR_SYSTEM,
    prompt: `${renderGroundingBlock(ctx)}
${localeBlock ? `\n${localeBlock}\n` : ""}
${opts.prompt ? `\nAdditional direction from the user: ${opts.prompt}\n` : ""}
Create exactly 1 short-form cinematic marketing video blueprint for this business${typeHint}. This is video ${opts.index + 1} of ${opts.total} — make it feel distinct from others in the set.

TARGET DURATION: ${durationTarget} seconds. The "duration" field MUST be exactly ${durationTarget}. Script word count must match the duration guideline in the system prompt. Shot durations must sum to exactly ${durationTarget}s.

OUTPUT CONSTRAINTS (strictly enforce to avoid truncation):
- script: write exactly enough words to fill ${durationTarget}s of spoken delivery (see word count guidelines above)
- storyboard: max 2 sentences
- shots array: exactly 4 shots, no more; shot durations must sum to ${durationTarget}
- All string fields: max 1 sentence each

Return JSON with this exact structure:
{
  "videos": [
    {
      "title": "short punchy title",
      "type": "promo | product | social",
      "script": "full actor dialogue as one continuous spoken performance — first person direct to camera, no scene markers or stage directions",
      "storyboard": "2-sentence visual narrative overview",
      "duration": ${durationTarget},
      "hookStrength": <0–100 integer>,
      "engagementPotential": <0–100 integer>,
      "viralPotential": <0–100 integer>,
      "cinematicPlan": {
        "visualStyle": "one-sentence style description",
        "characterDescription": "appearance in one sentence",
        "environment": "location in one sentence",
        "lighting": "lighting in one sentence",
        "cameraLanguage": "primary techniques in one sentence",
        "performanceDirection": "acting direction in one sentence",
        "shots": [
          {
            "shotNumber": 1,
            "duration": <integer seconds>,
            "dialogue": "exact words the actor speaks during this shot — or empty string if silent",
            "environment": "location — one phrase",
            "subjectAction": "what subject does — one phrase",
            "facialExpression": "expression — two words",
            "bodyMovement": "movement — one phrase",
            "cameraMovement": "e.g. Dolly In",
            "lensStyle": "e.g. 35mm",
            "lighting": "lighting — one phrase",
            "visualEffects": "effects — one phrase or 'none'",
            "transition": "e.g. Hard Cut"
          }
        ],
        "textOverlayPlacement": "one sentence",
        "finalHeroShot": "one sentence"
      }
    }
  ]
}`,
    maxTokens: 4096,
  });
  const v = response.videos[0];
  return { ...v, cinematicPlan: JSON.stringify(v.cinematicPlan) };
}

export async function generateVideoBlueprints(
  ctx: GroundingContext,
  opts: { count: number; type?: string; prompt?: string; targetDuration?: number; locale?: string },
): Promise<VideoBlueprintResult[]> {
  // Generate one video per Claude call (fits in 4096 tokens even for verbose output).
  // Run all in parallel for speed — N concurrent Sonnet calls is fine under normal quota.
  const jobs = Array.from({ length: opts.count }, (_, i) =>
    generateSingleVideoBlueprint(ctx, { ...opts, index: i, total: opts.count, targetDuration: opts.targetDuration }),
  );
  return Promise.all(jobs);
}

export interface AdCreativeResult {
  headline: string;
  description: string;
  cta: string;
  type: string;
  hookStrength: number;
  conversionPotential: number;
}

export async function generateAdCreatives(
  ctx: GroundingContext,
  opts: { platform: string; count: number; prompt?: string; locale?: string },
): Promise<AdCreativeResult[]> {
  const localeBlock = renderLocaleBlock(opts.locale);
  const response = await generateJson<{ ads: AdCreativeResult[] }>({
    system:
      "You are a senior performance ad copywriter. You write specific, on-brand ad creatives grounded in the " +
      "real business context provided — never generic filler, never an ad about the platform itself. " +
      "Respond with ONLY a single JSON object, no prose.",
    prompt: `${renderGroundingBlock(ctx)}
${localeBlock ? `\n${localeBlock}\n` : ""}
${opts.prompt ? `\nAdditional direction from the user: ${opts.prompt}\n` : ""}
Write exactly ${opts.count} distinct ${opts.platform} ad creative(s) for this specific business. Return JSON:
{
  "ads": [
    { "headline": "punchy headline specific to this business", "description": "ad body copy", "cta": "short call to action", "type": "image | video | carousel", "hookStrength": 0-100 integer estimate, "conversionPotential": 0-100 integer estimate }
  ]
}
The "ads" array must contain exactly ${opts.count} items.`,
  });
  return response.ads.slice(0, opts.count);
}

export interface CompetitorResult {
  name: string;
  websiteUrl: string;
  industry: string;
  description: string;
  strengths: string;
  weaknesses: string;
  marketGaps: string;
  pricingInsights: string;
  messagingInsights: string;
  hookStrength: number;
  conversionPotential: number;
  differentiationScore: number;
}

export interface ContentPieceResult {
  title: string;
  body: string;
  metaDescription: string;
  seoKeywords: string;
  hookStrength: number;
  conversionPotential: number;
  engagementPotential: number;
  viralPotential: number;
}

const CONTENT_TYPE_BRIEFS: Record<string, string> = {
  blog: "an engaging, informative blog post (800-1000 words) that addresses a key pain point or topic highly relevant to this business's target audience, using the business's brand voice — with a compelling intro, practical sections with markdown subheadings (##), and a clear CTA",
  whitepaper: "a concise executive whitepaper (600-800 words) that positions this business as a thought leader in its space — include an Executive Summary, 3-4 key insight sections with markdown subheadings (##), and strategic recommendations grounded in the business's market context",
  "case-study": "a compelling case study (500-700 words) showing how this type of business helped a client solve a real problem — structured as ## The Challenge, ## The Solution, ## The Results, with specific plausible outcomes matching this business's value proposition",
  "landing-page": "high-converting landing page copy structured with: ## Headline (punchy H1), ## Value Proposition (subheadline), ## Key Benefits (3 bullet points), ## Social Proof (a testimonial-style quote), ## Features (3 key features), ## CTA — grounded in this business's ICP and UVP",
  "email-sequence": "a 3-email nurture sequence (200-250 words each) designed to move a lead from awareness to purchase for this business — each email includes ## Email 1/2/3, Subject:, Preview:, and Body: — all grounded in the business's brand voice and audience",
  "press-release": "a professional press release (400-500 words) announcing a significant milestone or launch for this business — include ## HEADLINE, dateline (city, date), lead paragraph (who/what/when/where/why), two supporting paragraphs, a quote from a company spokesperson, and a boilerplate paragraph",
};

export async function generateContentPieces(
  ctx: GroundingContext,
  opts: { type: string; count: number; prompt?: string; locale?: string },
): Promise<ContentPieceResult[]> {
  const brief = CONTENT_TYPE_BRIEFS[opts.type] ?? CONTENT_TYPE_BRIEFS.blog;
  const cap = Math.min(opts.count, 3);
  const localeBlock = renderLocaleBlock(opts.locale);

  const response = await generateJson<{ pieces: ContentPieceResult[] }>({
    system:
      "You are a senior content strategist and copywriter. You write high-quality, specific marketing content " +
      "grounded in the real business context provided — never generic filler, never content about a fictional " +
      "or placeholder business. Every piece must name the actual business, reference its real products/services, " +
      "and speak directly to its target audience. Use the brand voice described. " +
      "Score each piece honestly with integer scores 60–99. Respond with ONLY a single JSON object, no prose.",
    prompt: `${renderGroundingBlock(ctx)}
${localeBlock ? `\n${localeBlock}\n` : ""}
${opts.prompt ? `\nAdditional direction from the user: ${opts.prompt}\n` : ""}
Write exactly ${cap} piece(s) of the following content type: ${brief}

IMPORTANT: Every word must be specific to THIS business — use the actual business name, its exact products/services, its specific target audience, and its brand voice from the context above. Do not use generic marketing boilerplate.

Return JSON:
{
  "pieces": [
    {
      "title": "the specific headline or document title for this piece",
      "body": "the complete content body using markdown for structure (## headings, bullet points etc.)",
      "metaDescription": "a 150-160 character SEO meta description specific to this piece and this business",
      "seoKeywords": "6-8 space-separated keywords relevant to this piece and this business's industry",
      "hookStrength": <integer 60-99 honest rating of the opening hook's ability to capture attention>,
      "conversionPotential": <integer 60-99 honest rating of likelihood this content converts readers>,
      "engagementPotential": <integer 60-99 honest rating of share/engagement likelihood>,
      "viralPotential": <integer 60-99 honest rating of potential to be widely shared>
    }
  ]
}
The "pieces" array must contain exactly ${cap} item(s).`,
    maxTokens: 8192,
  });

  return (response.pieces ?? []).slice(0, cap);
}

export async function generateCompetitors(ctx: GroundingContext): Promise<CompetitorResult[]> {
  const response = await generateJson<{ competitors: CompetitorResult[] }>({
    system:
      "You are a competitive intelligence researcher. You identify REAL, currently-operating companies " +
      "(with real names and real website URLs you know to be accurate) that genuinely compete with the " +
      "business described. Never invent fictional companies. If you are not confident a company is real " +
      "and its URL correct, do not include it. Respond with ONLY a single JSON object, no prose.",
    prompt: `Business to find competitors for: ${ctx.project.name} (${ctx.project.websiteUrl})
Industry: ${ctx.analysis.industry}
Summary: ${ctx.analysis.businessSummary}
Products: ${ctx.analysis.products}
Services: ${ctx.analysis.services}
Unique value proposition: ${ctx.analysis.uniqueValueProposition}
Target customers: ${ctx.analysis.targetCustomers}

Identify up to 5 real, well-known companies that compete with this specific business in this specific
industry. Return JSON:
{
  "competitors": [
    {
      "name": "real company name",
      "websiteUrl": "https://real-domain.com",
      "industry": "their industry category",
      "description": "what they actually do, 1-2 sentences",
      "strengths": "their real competitive strengths",
      "weaknesses": "their real weaknesses relative to this business",
      "marketGaps": "gaps this company leaves open that ${ctx.project.name} could exploit",
      "pricingInsights": "what is publicly known/estimated about their pricing",
      "messagingInsights": "how they position/message themselves",
      "hookStrength": 0-100 integer estimate of their marketing hook strength,
      "conversionPotential": 0-100 integer estimate,
      "differentiationScore": 0-100 integer estimate of how differentiated ${ctx.project.name} could be from them
    }
  ]
}`,
  });
  return response.competitors.slice(0, 5);
}
