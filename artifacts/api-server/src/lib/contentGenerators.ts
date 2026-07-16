import { generateJson } from "./aiJson.js";
import { renderGroundingBlock, type GroundingContext } from "./projectContext.js";

export interface SocialPostResult {
  platform: string;
  caption: string;
  hashtags: string;
  cta: string;
}

export async function generateSocialPosts(
  ctx: GroundingContext,
  opts: { platforms: string[]; perPlatform: number; prompt?: string },
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
  opts: { type: string; subjectHint?: string; prompt?: string },
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
  });
}

export interface VideoBlueprintResult {
  title: string;
  type: string;
  script: string;
  storyboard: string;
  duration: number;
  hookStrength: number;
  engagementPotential: number;
  viralPotential: number;
}

export async function generateVideoBlueprints(
  ctx: GroundingContext,
  opts: { count: number; type?: string; prompt?: string },
): Promise<VideoBlueprintResult[]> {
  const response = await generateJson<{ videos: VideoBlueprintResult[] }>({
    system:
      "You are a senior video marketing creative director. You write specific, on-brand video scripts and " +
      "storyboards grounded in the real business context provided — never generic filler, never a video " +
      "about the platform itself. Respond with ONLY a single JSON object, no prose.",
    prompt: `${renderGroundingBlock(ctx)}
${opts.prompt ? `\nAdditional direction from the user: ${opts.prompt}\n` : ""}
Write exactly ${opts.count} distinct short-form marketing video blueprint(s) for this specific business${opts.type ? `, of type "${opts.type}"` : " (mix of promo/product/social types as appropriate)"}.
Each must have a strong hook, a full script with scene/beat breaks, and a scene-by-scene storyboard description.
Return JSON:
{
  "videos": [
    {
      "title": "short descriptive title",
      "type": "promo | product | social",
      "script": "full script with HOOK/scene breaks, tailored to this business",
      "storyboard": "line-separated scene-by-scene visual description",
      "duration": integer seconds (15-900),
      "hookStrength": 0-100 integer estimate,
      "engagementPotential": 0-100 integer estimate,
      "viralPotential": 0-100 integer estimate
    }
  ]
}
The "videos" array must contain exactly ${opts.count} items.`,
    maxTokens: 8192,
  });
  return response.videos.slice(0, opts.count);
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
  opts: { platform: string; count: number; prompt?: string },
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
  opts: { type: string; count: number; prompt?: string },
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
