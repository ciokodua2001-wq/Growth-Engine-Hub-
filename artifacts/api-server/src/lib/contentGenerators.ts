import { generateJson } from "./aiJson.js";
import { renderGroundingBlock, projectIdentityLabel, type GroundingContext } from "./projectContext.js";

export interface SocialPostResult {
  platform: string;
  caption: string;
  hashtags: string;
  cta: string;
  imagePrompt: string; // DALL-E prompt for the accompanying creative image
}

export async function generateSocialPosts(
  ctx: GroundingContext,
  opts: { platforms: string[]; perPlatform: number; prompt?: string; locale?: string },
): Promise<SocialPostResult[]> {
  const requestedTotal = opts.platforms.length * opts.perPlatform;
  const response = await generateJson<{ posts: SocialPostResult[] }>({
    system:
      "You are a senior social media copywriter. You write specific, on-brand social posts grounded in the " +
      "real business context provided — never generic marketing filler, never posts about the platform " +
      "itself. Respond with ONLY a single JSON object, no prose.",
    prompt: `${renderGroundingBlock(ctx)}
${opts.prompt ? `\nAdditional direction from the user: ${opts.prompt}\n` : ""}
Write exactly ${opts.perPlatform} social post(s) for EACH of these platforms: ${opts.platforms.join(", ")}.
Each post must be tailored to that platform's tone/format and to THIS business's audience, voice, and value
proposition. Return JSON:
{
  "posts": [
    { "platform": "one of: ${opts.platforms.join(", ")}", "caption": "the post copy", "hashtags": "space-separated hashtags relevant to this business, or empty string", "cta": "a short call to action, or empty string", "imagePrompt": "a concise DALL-E image prompt (1-2 sentences) describing a high-quality, platform-appropriate marketing visual that complements this specific post — photorealistic or clean illustration style, no text or words in the image, no logos, grounded in what this business actually does" }
  ]
}
The "posts" array must contain exactly ${requestedTotal} items (${opts.perPlatform} per platform).`,
    locale: opts.locale,
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
  return generateJson<EmailResult>({
    system:
      "You are a senior email marketing copywriter. You write specific, on-brand marketing emails grounded " +
      "in the real business context provided — never generic filler, never an email about the platform " +
      "itself. Use {{first_name}} as the recipient placeholder. Respond with ONLY a single JSON object, no prose.",
    prompt: `${renderGroundingBlock(ctx)}
${opts.subjectHint ? `\nRequested subject line direction: ${opts.subjectHint}\n` : ""}
${opts.prompt ? `\nAdditional direction from the user: ${opts.prompt}\n` : ""}
Write ${EMAIL_TYPE_BRIEFS[opts.type] ?? EMAIL_TYPE_BRIEFS.welcome} for this specific business. Return JSON:
{
  "subject": "a compelling subject line specific to this business",
  "previewText": "a short preview/preheader line",
  "body": "the full email body, using {{first_name}} as the greeting placeholder, with real paragraphs and a clear CTA"
}`,
    locale: opts.locale,
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

const AI_VIDEO_DIRECTOR_SYSTEM = `You are a world-class commercial screenwriter, creative director, and film director. Create specific, production-ready commercial briefs grounded in the business context and the user's creative vision.

CREATIVE-VISION FIDELITY — HIGHEST PRIORITY
When the user provides a sample script or detailed creative brief, treat it as the controlling source of creative intent, not a loose prompt. Preserve its core concept, scene order, named roles, key dialogue, requested language/accent, duration/timing, product benefits, visual beats, brand reveal, and call to action. Do not flatten a multi-character comedy or scene-by-scene brief into a generic single-speaker monologue. Do not replace distinctive requested dialogue with generic copy. Keep provided lines verbatim wherever possible; make only minimal edits needed for clarity, timing, or factual accuracy. If a requested product claim cannot be verified from the supplied brief/business context, retain the idea cautiously or flag it in the brief rather than inventing a claim.

ADAPTATION, NOT REPLACEMENT
Build on the user's idea with stronger comedy, emotional escalation, vivid cinematic direction, performances, transitions, music, and a memorable payoff when these support the supplied vision. Preserve any exact requirements and do not introduce contradictory creative choices. Clearly distinguish spoken dialogue/voiceover from stage directions and on-screen text. Keep the requested language; never add unrequested languages or slang.

SCRIPT AND SHOTS
The script may use scene headings, time ranges, character names, action, dialogue, and voiceover when the concept calls for them. A multi-character script is allowed and expected when the user supplies multiple roles. Maintain identity, wardrobe, and location continuity. The script's spoken words should fit the selected duration; scene directions and headings are not spoken. Each cinematic-plan shot must include the exact words spoken in that shot (or an empty string when silent), in the same order as the script. Preserve user-provided dialogue verbatim in both the script and shot dialogue.

DURATION
15s → ~35–40 spoken words | 30s → ~70–80 | 45s → ~105–120 | 60s → ~140–160 | 90s → ~210–230 | 120s → ~280–310. The requested duration field must be exact, and shot durations must sum exactly to it. If supplied dialogue exceeds the speaking-time budget, preserve the user's key quoted lines and CTA first, tighten nonessential dialogue/voiceover, and retain every requested scene as a visual beat. Never solve a timing conflict by deleting scenes, changing the concept, or silently replacing the user's key dialogue with generic copy.

CINEMATIC DIRECTION
Think like a director, cinematographer, and commercial production company. Give concrete, filmable action, authentic performances, camera movement, lighting, transitions, music/sound cues, and visual progression. Preserve described casting, setting, cultural context, wardrobe, and continuity. Do not invent product capabilities, guarantees, endorsements, or other factual claims.

Respond with ONLY a single JSON object matching the requested structure, no prose outside the JSON.`;

export function buildCreativeVisionInstructions(sampleScript: string, targetDuration: number): string {
  return `\n\nUSER CREATIVE BRIEF — CONTROLLING SOURCE OF TRUTH\nThe complete sample below is intentional creative direction, not disposable inspiration. Follow its scene sequence, roles, timing, key dialogue, language, tone, brand reveal, and CTA. Preserve distinctive supplied dialogue substantially verbatim; do not replace it with a generic monologue. Add or heighten cinematic comedy, emotion, music, transitions, and visuals around the user's idea, without contradicting it. Keep the selected runtime at exactly ${targetDuration} seconds and ensure the scenes and spoken lines fit.\n\nBEGIN USER SAMPLE (preserve the content and intent):\n${sampleScript}\nEND USER SAMPLE\n\nTranslate the supplied scene beats into a screenplay-style script and a matching cinematic shot plan. Keep all requested spoken lines in order and assign them accurately to shot dialogue. Use stage direction for visual/action/music cues; do not mistake those cues for spoken words.\n`;
}

async function generateSingleVideoBlueprint(
  ctx: GroundingContext,
  opts: { type?: string; prompt?: string; sampleScript?: string; index: number; total: number; targetDuration?: number; locale?: string },
): Promise<VideoBlueprintResult> {
  // Generate exactly ONE video per call to guarantee the JSON response stays
  // well within the 8192-token output limit regardless of how verbose Claude is.
  const typeHint = opts.type ? `, of type "${opts.type}"` : (
    opts.index % 3 === 0 ? ', of type "promo"' :
    opts.index % 3 === 1 ? ', of type "product"' :
                           ', of type "social"'
  );
  const durationTarget = opts.targetDuration ?? 45;
  const response = await generateJson<{ videos: [Omit<VideoBlueprintResult, "cinematicPlan"> & { cinematicPlan: CinematicPlan }] }>({
    system: AI_VIDEO_DIRECTOR_SYSTEM,
    prompt: `${renderGroundingBlock(ctx)}
${opts.prompt ? `\nAdditional direction from the user: ${opts.prompt}\n` : ""}
${opts.sampleScript ? buildCreativeVisionInstructions(opts.sampleScript, durationTarget) : ""}
Create exactly 1 short-form cinematic marketing video blueprint for this business${typeHint}. This is video ${opts.index + 1} of ${opts.total} — make it feel distinct from others in the set.

TARGET DURATION: ${durationTarget} seconds. The "duration" field MUST be exactly ${durationTarget}. Script word count must match the duration guideline in the system prompt. Shot durations must sum to exactly ${durationTarget}s.

OUTPUT GUIDANCE:
- Make the script and storyboard reflect the supplied creative brief, including scene headings, timing, character dialogue, transitions, and CTA where provided. Do not flatten or omit requested scenes.
- Keep the total spoken dialogue within the selected runtime. If the sample is overlength, keep its signature quoted lines and CTA, shorten less-essential dialogue/voiceover, and preserve the full scene sequence visually. Do not silently omit content; where a material conflict remains, state it briefly in the storyboard instead of inventing a different concept.
- Provide at least one cinematic-plan shot for every distinct scene in the user's sample (or 5–10 coherent shots if no scene structure is supplied). Additional shots are welcome when they help translate the brief. Shot durations must be positive integers summing to exactly ${durationTarget}.
- Keep each shot's dialogue faithful to the corresponding spoken line(s), in order. Use multi-sentence descriptions wherever the requested visual detail needs them; do not compress away essential direction.

Return JSON with this exact structure:
{
  "videos": [
    {
      "title": "short punchy title",
      "type": "promo | product | social",
      "script": "complete screenplay-style commercial script. Preserve the user's scene structure, timing, named roles, key dialogue, requested language, and CTA; include concise stage directions and clearly labeled dialogue/voiceover as appropriate",
      "storyboard": "scene-by-scene visual narrative reflecting the user's supplied beats, transitions, and cinematic direction",
      "duration": ${durationTarget},
      "hookStrength": <0–100 integer>,
      "engagementPotential": <0–100 integer>,
      "viralPotential": <0–100 integer>,
      "cinematicPlan": {
        "visualStyle": "one-sentence style description",
        "characterDescription": "consistent appearance and wardrobe of all featured characters",
        "environment": "locations and continuity across scenes",
        "lighting": "lighting direction, including any scene-to-scene transition",
        "cameraLanguage": "camera and lens language suited to the supplied scenes",
        "performanceDirection": "performance direction for each role, including comedic and emotional beats where needed",
        "shots": [
          {
            "shotNumber": 1,
            "duration": <integer seconds>,
            "dialogue": "exact words the actor speaks during this shot — or empty string if silent",
            "environment": "specific location and continuity detail",
            "subjectAction": "filmable action and story beat for this shot",
            "facialExpression": "specific readable expression",
            "bodyMovement": "specific performance movement",
            "cameraMovement": "e.g. Dolly In",
            "lensStyle": "e.g. 35mm",
            "lighting": "specific lighting direction for this shot",
            "visualEffects": "specific effect or 'none'",
            "transition": "transition into the next story beat"
          }
        ],
        "textOverlayPlacement": "placement and timing for requested on-screen brand/CTA text; include exact user-supplied text where appropriate",
        "finalHeroShot": "detailed final brand reveal and call-to-action frame, including exact supplied URL and the duration it remains visible"
      }
    }
  ]
}`,
    maxTokens: 8192,
    locale: opts.locale,
  });
  const v = response.videos[0];
  return { ...v, cinematicPlan: JSON.stringify(v.cinematicPlan) };
}

export async function generateVideoBlueprints(
  ctx: GroundingContext,
  opts: { count: number; type?: string; prompt?: string; sampleScript?: string; targetDuration?: number; locale?: string },
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
  const response = await generateJson<{ ads: AdCreativeResult[] }>({
    system:
      "You are a senior performance ad copywriter. You write specific, on-brand ad creatives grounded in the " +
      "real business context provided — never generic filler, never an ad about the platform itself. " +
      "Respond with ONLY a single JSON object, no prose.",
    prompt: `${renderGroundingBlock(ctx)}
${opts.prompt ? `\nAdditional direction from the user: ${opts.prompt}\n` : ""}
Write exactly ${opts.count} distinct ${opts.platform} ad creative(s) for this specific business. Return JSON:
{
  "ads": [
    { "headline": "punchy headline specific to this business", "description": "ad body copy", "cta": "short call to action", "type": "image | video | carousel", "hookStrength": 0-100 integer estimate, "conversionPotential": 0-100 integer estimate }
  ]
}
The "ads" array must contain exactly ${opts.count} items.`,
    locale: opts.locale,
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

  const response = await generateJson<{ pieces: ContentPieceResult[] }>({
    system:
      "You are a senior content strategist and copywriter. You write high-quality, specific marketing content " +
      "grounded in the real business context provided — never generic filler, never content about a fictional " +
      "or placeholder business. Every piece must name the actual business, reference its real products/services, " +
      "and speak directly to its target audience. Use the brand voice described. " +
      "Score each piece honestly with integer scores 60–99. Respond with ONLY a single JSON object, no prose.",
    prompt: `${renderGroundingBlock(ctx)}
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
    locale: opts.locale,
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
    prompt: `Business to find competitors for: ${ctx.project.name} (${projectIdentityLabel(ctx.project)})
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
