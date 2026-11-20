import { describe, expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { getConstructionCost } from "../src/shared/settlement/construction-costs";
import { PRODUCTION_RULES } from "../src/shared/settlement/production-rules";
import { constructionCost } from "../src/shared/settlement/settlement-placement";

describe("local construction receipts", () => {
  it("preserves every local source receipt in BuildingType order, with canonical Monument and Catapult Tower identities", () => {
    const expected = [
      [0, 0],
      [2, 0],
      [2, 3],
      [2, 0],
      [3, 5],
      [4, 4],
      [2, 3],
      [0, 0], // 7: reserved (Temple removed 2026-10-19)
      [2, 2],
      [4, 7],
      [4, 0],
      [4, 0],
      [4, 0],
      [4, 0],
      [4, 0],
      [2, 2],
      [3, 4], // Catapult Tower
      [2, 0],
      [2, 0],
      [2, 0],
      [2, 0],
      [2, 2],
      [2, 0],
      [2, 2],
      [2, 2],
      [2, 2],
      [2, 2],
      [4, 3],
      [3, 3],
      [4, 3],
      [0, 0],
      [2, 2],
      [2, 2],
      [2, 2],
      [2, 2],
      [2, 0],
      [2, 3],
      [3, 3],
      [3, 3],
      [4, 6],
      [3, 3],
      [2, 0],
      [2, 0],
      [2, 0],
      [2, 2],
      // 45–56: cedar, walnut and mahogany specialists repeat the hardwood tier's receipts.
      ...Array.from({ length: 3 }, () => [[2, 0], [2, 0], [2, 0], [2, 2]]).flat(),
      // 57–59: small, medium and big residences (POP-02 proposal).
      [3, 2], [4, 4], [6, 6],
      // 60–61: Flax Farm and Weaver (FLAX-CLOTH-SHIPS-01 initial tuning).
      [2, 1], [2, 2],
      // 62: Commander's Lodge (COMMANDER-SYSTEM-01 canonical construction recipe).
      [4, 5]
    ];
    for (const building of BUILDING_CATALOG.filter(entry => entry.id !== 7)) {
      const receipt = expected[building.id]!;
      expect(constructionCost(building.id), building.name).toEqual({
        planks: receipt[0],
        stone: receipt[1]
      });
    }
    for (const { id } of BUILDING_CATALOG) expect(() => constructionCost(id)).not.toThrow();
    expect(() => constructionCost(30)).toThrow("Unknown building ID");
    expect(() => constructionCost(38)).toThrow("Unknown building ID");
  });

  it("keeps the original cheap woodcutter, large farm and free starting headquarters distinct", () => {
    expect(constructionCost(17)).toEqual({ planks: 2, stone: 0 });
    expect(constructionCost(37)).toEqual({ planks: 3, stone: 3 });
    expect(constructionCost(0)).toEqual({ planks: 0, stone: 0 });
    expect(constructionCost(39)).toEqual({ planks: 4, stone: 6 });
  });

  it("charges only construction materials, never a worker hammer or military weapons", () => {
    for (const building of BUILDING_CATALOG.filter(entry => entry.id !== 7)) {
      const cost = constructionCost(building.id);
      expect(Object.keys(cost)).toEqual(["planks", "stone"]);
      expect(Number.isInteger(cost.planks) && cost.planks >= 0).toBe(true);
      expect(Number.isInteger(cost.stone) && cost.stone >= 0).toBe(true);
    }
    expect(constructionCost(1)).toEqual({ planks: 2, stone: 0 });
    expect(constructionCost(9)).toEqual({ planks: 4, stone: 7 });
  });

  it("applies small national timber/stone preferences without touching the fixed monument", () => {
    // Base receipts stay available for shared callers and non-game tools.
    expect(constructionCost(17)).toEqual({ planks: 2, stone: 0 });
    expect(constructionCost(17, "roman")).toEqual({ planks: 3, stone: 0 });
    expect(constructionCost(17, "japanese")).toEqual({ planks: 2, stone: 1 });
    expect(constructionCost(17, "nubian")).toEqual({ planks: 1, stone: 1 });
    expect(constructionCost(17, "viking")).toEqual({ planks: 3, stone: 0 });
    expect(constructionCost(37, "roman")).toEqual({ planks: 4, stone: 3 });
    expect(constructionCost(37, "japanese")).toEqual({ planks: 3, stone: 4 });
    expect(constructionCost(37, "nubian")).toEqual({ planks: 2, stone: 4 });
    expect(constructionCost(37, "viking")).toEqual({ planks: 4, stone: 2 });
    for (const nation of ["roman", "japanese", "nubian", "viking"] as const)
      expect(constructionCost(7, nation)).toEqual(constructionCost(7));
  });

  it("protects the source catalogue from per-site counter mutations and rejects unknown types", () => {
    const cost = getConstructionCost(37);
    cost.planks = 0;
    cost.stone = 0;
    expect(getConstructionCost(37)).toEqual({ planks: 3, stone: 3 });
    expect(() => getConstructionCost(500)).toThrow("Unknown building ID");
  });

  it("keeps military buildings as held services while enabling their construction receipts", () => {
    for (const id of [1, 2, 4, 9]) {
      expect(constructionCost(id).planks).toBeGreaterThan(0);
      expect(PRODUCTION_RULES[id]?.service).toBe(true);
      expect(PRODUCTION_RULES[id]?.outputs).toEqual([]);
    }
  });
});
