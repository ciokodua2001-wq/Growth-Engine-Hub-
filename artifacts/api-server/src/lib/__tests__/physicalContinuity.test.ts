import { describe, expect, it } from "vitest";
import { formatCinematicShotPlan, PHYSICAL_CONTINUITY_RULES, withPhysicalContinuity } from "../physicalContinuity.js";

describe("physical continuity safeguards", () => {
  it("adds explicit gravity, support, contact, liquid, and CAUSE-AND-EFFECT requirements", () => {
    const prompt = withPhysicalContinuity("A person pours milk into a glass.");
    for (const rule of ["gravity", "supported by a hand", "contact before", "Liquids obey gravity", "never float", "CAUSE-AND-EFFECT"]) {
      expect(prompt).toContain(rule);
    }
    expect(withPhysicalContinuity(prompt)).toBe(prompt);
  });

  it("retains approved physical prop actions and handling details from the shot plan", () => {
    const plan = JSON.stringify({
      visualStyle: "Natural family-comedy realism",
      characterDescription: "Mum in a blue cardigan",
      shots: [{
        duration: 5,
        environment: "Kitchen table",
        subjectAction: "Mum lifts the glass by its rim and pours milk from the held jug",
        objectSupport: "The jug stays in Mum's right hand; the glass base rests flat on the table",
        objectHandling: "The jug spout touches above the glass; milk flows only while tilted",
        bodyMovement: "Mum steadies the glass with her left hand",
        dialogue: "Careful now.",
        transition: "Cut after the jug is set back down",
      }],
    });
    const brief = formatCinematicShotPlan(plan);
    expect(brief).toContain("objectSupport: The jug stays in Mum's right hand");
    expect(brief).toContain("objectHandling: The jug spout touches above the glass");
    expect(brief).toContain("subjectAction: Mum lifts the glass");
    expect(brief).toContain("transition: Cut after the jug is set back down");
  });

  it("preserves legacy non-JSON shot plans", () => {
    expect(formatCinematicShotPlan("Shot one: a glass rests on the table.")).toBe("Shot one: a glass rests on the table.");
    expect(PHYSICAL_CONTINUITY_RULES).toContain("object permanence");
  });
});

describe("human anatomy safeguards", () => {
  it("requires correct limb and finger counts", () => {
    expect(PHYSICAL_CONTINUITY_RULES).toContain("exactly two arms");
    expect(PHYSICAL_CONTINUITY_RULES).toContain("five fingers per hand");
  });
});
