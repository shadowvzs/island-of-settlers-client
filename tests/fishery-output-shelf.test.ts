import { buildingNavigationLevel, loadBuildingNavigation, loadedBuildingNavigation }
  from "@shared/catalog/building-data/navigation";
import { describe, expect, it } from "vitest";

import { NATIONS } from "../../island-of-settlers-shared/src/nations";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { isBuildingCourtyardPointWalkable } from "../src/render-common/buildings/building-courtyard";
import { computeBuildingNavigationLevel } from "../src/render-common/buildings/building-geometry-reference";
import { getBuildingStockContact } from "../src/render-common/buildings/building-stock-anchors";
import { getBuildingStockLayout } from "../src/render-common/buildings/building-stock-layout";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { getRomanWareStockSlots, romanWareStockPlacement } from "../src/render-common/buildings/roman-ware-stock";

describe("fishery overflow shelf", () => {
  it.each(NATIONS)("supports the complete four-fish delivery for %s in both qualities", nation => {
    for (const detailed of [true, false]) {
      const recipe = createNationBuildingRecipe(getBuildingDefinition(18), nation, detailed);
      const fish = recipe.parts.filter(part => part.stock?.ware === "fish"
        && (part.stock.kind ?? "output") === "output");
      expect([...new Set(fish.map(part => part.stock!.slot))].sort((a, b) => a - b))
        .toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
      // Newly filled top slots must have their own real carrier contact in every orientation.
      for (const slot of [6, 7, 8]) for (const rotation of [0, 1, 2, 3]) {
        const contact = getBuildingStockContact(18, "output", "fish", slot,
          40, 50, rotation, 2, undefined, undefined, { nation, level: 1 });
        expect(contact).not.toBeNull();
        expect(contact!.slot).toBe(slot);
        expect(isBuildingCourtyardPointWalkable(18, 40, 50, rotation,
          { x: contact!.approach[0], z: contact!.approach[2] }, undefined, undefined,
          { nation, level: 1 })).toBe(true);
      }
    }
  });

  it.each(NATIONS)("seats the upper %s fish on their real lower layer", nation => {
    const { recipe, scale } = getBuildingStockLayout(18, { nation });
    const slots = getRomanWareStockSlots(recipe, scale).filter(slot => slot.stock.ware === "fish");
    expect(slots).toHaveLength(9);
    for (const slot of slots.filter(slot => slot.stock.slot >= 3)) {
      expect(slot.support?.stock.slot).toBe(slot.stock.slot - 3);
      const upper = romanWareStockPlacement(slot, "fish", scale);
      const lower = romanWareStockPlacement(slot.support!, "fish", scale);
      expect(upper.center[0]).toBeCloseTo(lower.center[0], 8);
      expect(upper.center[2]).toBeCloseTo(lower.center[2], 8);
      expect(upper.position[1] - lower.position[1]).toBeGreaterThan(0);
      expect(upper.position[1] - lower.position[1]).toBeLessThan(.09);
    }
  });

  it.each(NATIONS)("ships matching %s navigation for all five upgrade levels", async nation => {
    await loadBuildingNavigation(nation);
    const file = loadedBuildingNavigation("fishery", nation)!;
    expect(file).toBeDefined();
    for (const level of [1, 2, 3, 4, 5] as const) {
      const generated = computeBuildingNavigationLevel(18, nation, level);
      expect(buildingNavigationLevel(file, level)).toEqual(JSON.parse(JSON.stringify(generated)));
    }
  });
});
