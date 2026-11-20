import { expect, it } from "vitest";

import { ARCHER_SCAFFOLD_SITE } from "../src/render-common/buildings/bandit-camp-plan";
import { adventureDefencePlan } from "../src/shared/settlement/adventure-camp-defences";

/** Seeds (of 60) that roll no defence at all, per difficulty. */
const UNDEFENDED_CAMPS = { easy: 48, hard: 0, medium: 20 } as const;

it("keeps adventure military buildings rare and scales sparse towers with difficulty", () => {
  for (const difficulty of ["easy", "medium", "hard"] as const) {
    const plans = Array.from({ length: 60 }, (_, seed) =>
      adventureDefencePlan({ difficulty, seed })
    );
    for (const plan of plans) {
      expect(plan.every((site) => site === ARCHER_SCAFFOLD_SITE)).toBe(true);
      expect(plan.length).toBeLessThanOrEqual(difficulty === "hard" ? 2 : 1);
    }
    expect(plans.filter((plan) => !plan.length).length)
      .toBe(UNDEFENDED_CAMPS[difficulty]);
  }
});
