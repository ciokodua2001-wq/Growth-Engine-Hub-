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
      "duration": integer seconds (15-90),
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
