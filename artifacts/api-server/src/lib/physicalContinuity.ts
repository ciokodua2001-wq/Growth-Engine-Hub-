/** Shared, testable visual-realism constraints applied to every video provider. */
export const PHYSICAL_CONTINUITY_RULES = `PHYSICAL REALISM AND CAUSE-AND-EFFECT — mandatory in every frame: Depict ordinary real-world gravity, weight, balance, friction, inertia, and object permanence. Every object must be visibly supported by a hand, surface, container, or fixture; never float, hover, pass through another object, teleport, or move without a physical cause. Show hands making contact before lifting, placing, opening, pouring, or releasing an object. A held object stays in the same hand with a consistent grip and orientation until it is deliberately transferred or set down. Liquids obey gravity and remain inside their container except while visibly poured; cups, bottles, food, and props stay on stable surfaces when not held. Actions follow the supplied script and shot plan exactly, in their stated order; do not replace them with contradictory, impossible, or unrelated actions. Preserve object positions and state across adjacent frames and cuts unless the script explicitly changes them. Keep each action simple enough to be visibly completed within the shot duration; if a requested action cannot fit, show a coherent partial action rather than skipping steps or inventing a result. Photorealistic physical behavior takes priority over spectacle or decorative effects.`;

export function withPhysicalContinuity(prompt: string): string {
  const source = prompt.trim();
  if (!source) return PHYSICAL_CONTINUITY_RULES;
  if (source.includes(PHYSICAL_CONTINUITY_RULES)) return source;
  return `${source}\n\n${PHYSICAL_CONTINUITY_RULES}`;
}

/** Keep approved shot-level actions available to downstream scene decomposition. */
export function formatCinematicShotPlan(rawPlan: string | null | undefined): string {
  if (!rawPlan?.trim()) return "";
  try {
    const parsed = JSON.parse(rawPlan) as {
      visualStyle?: string;
      characterDescription?: string;
      environment?: string;
      performanceDirection?: string;
      shots?: Array<Record<string, unknown>>;
    };
    const rows = (parsed.shots ?? []).map((shot, index) => {
      const fields = [
        ["duration", shot.duration], ["environment", shot.environment],
        ["subjectAction", shot.subjectAction], ["objectSupport", shot.objectSupport],
        ["objectHandling", shot.objectHandling], ["bodyMovement", shot.bodyMovement],
        ["facialExpression", shot.facialExpression], ["dialogue", shot.dialogue],
        ["transition", shot.transition],
      ].filter(([, value]) => typeof value === "string" && value.trim() || typeof value === "number")
        .map(([key, value]) => `${key}: ${String(value)}`);
      return fields.length ? `Shot ${index + 1}: ${fields.join("; ")}` : "";
    }).filter(Boolean);
    const overview = [
      parsed.visualStyle && `Visual style: ${parsed.visualStyle}`,
      parsed.characterDescription && `Character continuity: ${parsed.characterDescription}`,
      parsed.environment && `Environment continuity: ${parsed.environment}`,
      parsed.performanceDirection && `Performance direction: ${parsed.performanceDirection}`,
    ].filter(Boolean);
    return [...overview, ...rows].join("\n");
  } catch {
    // Older rows may contain plain text rather than serialized CinematicPlan.
    return rawPlan;
  }
}
