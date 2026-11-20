import { describe, expect, it } from "vitest";

import { getBuildingCardGroups, selectBuildingPicker } from "../src/app/settlement-ui/main-panel/build-helpers";
import { getConstructionCost } from "../src/shared/settlement/construction-costs";

describe("construction card receipts", () => {
  it("shows the actual national cost, including cloth and all monument materials", () => {
    for (const nation of ["roman", "indigenous", "nubian", "viking"] as const) {
      const groups = getBuildingCardGroups(selectBuildingPicker({ playerNation: nation }));
      for (const card of groups.flatMap(group => group.cards)) {
        const expected = Object.fromEntries(Object.entries(getConstructionCost(card.id, nation))
          .filter(([, count]) => count > 0));
        expect(Object.fromEntries(card.materials.map(row => [row.ware, row.count]))).toEqual(expected);
        expect(card.materials.every(row => row.name.length > 0)).toBe(true);
        expect(card.description.length).toBeGreaterThan(0);
      }
    }
  });

  it("uses nation-specific names for drink-chain cards", () => {
    const cards = getBuildingCardGroups(selectBuildingPicker({ playerNation: "maya" }))
      .flatMap(group => group.cards);
    expect(cards.find(card => card.id === 5)?.name).toBe("Cacao grove");
    expect(cards.find(card => card.id === 6)?.name).toBe("Cacao house");
  });
});
