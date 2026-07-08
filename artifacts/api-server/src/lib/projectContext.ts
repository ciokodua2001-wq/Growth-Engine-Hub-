import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  projectsTable,
  businessAnalysisTable,
  personasTable,
  marketingStrategyTable,
  competitorsTable,
} from "@workspace/db";

export interface GroundingContext {
  project: typeof projectsTable.$inferSelect;
  analysis: typeof businessAnalysisTable.$inferSelect;
  personas: (typeof personasTable.$inferSelect)[];
  strategy: (typeof marketingStrategyTable.$inferSelect) | null;
  competitors: (typeof competitorsTable.$inferSelect)[];
}

/**
 * Fetches everything needed to ground an AI generation call in a project's real
 * business context. Returns null if the project doesn't exist or its business
 * analysis hasn't completed yet — callers should surface a 409 telling the user
 * to run analysis first, since generating content without this context would
 * fall back to generic, non-business-specific output.
 */
export async function getGroundingContext(projectId: number): Promise<GroundingContext | null> {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  const [analysis] = await db
    .select()
    .from(businessAnalysisTable)
    .where(eq(businessAnalysisTable.projectId, projectId))
    .orderBy(desc(businessAnalysisTable.createdAt));

  if (!project || !analysis || analysis.status !== "complete") {
    return null;
  }

  const [personas, [strategy], competitors] = await Promise.all([
    db.select().from(personasTable).where(eq(personasTable.projectId, projectId)),
    db
      .select()
      .from(marketingStrategyTable)
      .where(eq(marketingStrategyTable.projectId, projectId))
      .orderBy(desc(marketingStrategyTable.createdAt)),
    db.select().from(competitorsTable).where(eq(competitorsTable.projectId, projectId)),
  ]);

  return { project, analysis, personas, strategy: strategy ?? null, competitors };
}

/** Renders the grounding context into a compact text block for use in AI prompts. */
export function renderGroundingBlock(ctx: GroundingContext): string {
  const { project, analysis, personas, strategy, competitors } = ctx;
  return `Business: ${project.name} (${project.websiteUrl})
Industry: ${analysis.industry}
Summary: ${analysis.businessSummary}
Products: ${analysis.products}
Services: ${analysis.services}
Unique value proposition: ${analysis.uniqueValueProposition}
Target customers: ${analysis.targetCustomers}
Ideal customer profile: ${analysis.idealCustomerProfile}
Customer pain points: ${analysis.customerPainPoints}
Brand voice: ${analysis.brandVoice}
Brand positioning: ${analysis.brandPositioning}
Customer benefits: ${analysis.customerBenefits}
Purchase triggers: ${analysis.purchaseTriggers}
${strategy ? `\nPositioning statement: ${strategy.positioningStatement}\nMessaging framework: ${strategy.messagingFramework}\nBrand voice guide: ${strategy.brandVoiceGuide}\nCampaign strategy: ${strategy.campaignStrategy}` : ""}
${personas.length > 0 ? `\nBuyer personas:\n${personas.map(p => `- ${p.name} (${p.occupation}): motivations="${p.motivations}", objections="${p.objections}"`).join("\n")}` : ""}
${competitors.length > 0 ? `\nKnown competitors: ${competitors.map(c => c.name).join(", ")}` : ""}`;
}
