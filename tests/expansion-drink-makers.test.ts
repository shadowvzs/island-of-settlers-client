import { expect, it } from "vitest";
import type { BuildingFirstNation } from "../src/render-common/workers/worker-nation";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { type BuildingPart, createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds, getRomanRecipeBounds } from "../src/render-common/buildings/building-recipe-fit";
import { withChineseTeaInputBays } from "../src/render-common/buildings/chinese-tea-input-bays";
import { decorateExpansionDrinkMaker } from "../src/render-common/buildings/expansion-drink-makers";
import { expansionDrinkWorkstation } from "../src/render-common/buildings/expansion-drink-maker-layout";

const NATIONS: BuildingFirstNation[] = ["chinese", "persian", "maya", "indigenous"];

it("preserves all maker inventories, operational anchors and plot bounds at both quality levels", () => {
  const definition = getBuildingDefinition(6);
  for (const detailed of [true, false]) for (const nation of NATIONS) {
    const original = createRomanBuildingRecipe(definition, detailed, false);
    const built = decorateExpansionDrinkMaker(original, 6, nation, detailed);
    const { parts: oldParts, ...oldAnchors } = original, { parts, drinkNation, ...anchors } = built;
    expect(drinkNation).toBe(nation);
    expect(anchors).toEqual(oldAnchors);
    const isInput = (part: BuildingPart) => part.stock?.kind === "input";
    const keptStock = (list: BuildingPart[]) => list.filter(part => part.stock && !isInput(part));
    expect(keptStock(parts)).toEqual(keptStock(oldParts));
    // Chinese tea (041bde88c) replaces its input stock with two ground bays per input ware.
    const inputs = nation === "chinese" ? withChineseTeaInputBays(original).parts : oldParts;
    expect(parts.filter(isInput)).toEqual(inputs.filter(isInput));
    const inputSlots = parts.filter(isInput).map(part => `${part.stock!.ware}:${part.stock!.slot}`);
    if (nation === "chinese")
      expect(inputSlots.sort()).toEqual(["teaLeaves:0", "teaLeaves:1", "water:0", "water:1"]);
    const before = getRomanRecipeBounds(definition, original), after = getRomanRecipeBounds(definition, built);
    expect(after.extentX).toBeLessThanOrEqual(before.extentX + .001);
    expect(after.extentZ).toBeLessThanOrEqual(before.extentZ + .001);
    expect(parts.every(part => [...part.position, ...part.size].every(Number.isFinite))).toBe(true);
  }
});

it("keeps the visible worker stance clear with reachable waist-to-chest hand contacts", () => {
  for (const nation of NATIONS) {
    const layout = expansionDrinkWorkstation(nation);
    expect(layout.workHeight).toBeGreaterThan(.3);
    expect(layout.workHeight).toBeLessThan(.4);
    for (const grip of [layout.leftGrip, layout.rightGrip]) {
      expect(Math.hypot(grip[0] - layout.workerStand[0], grip[2] - layout.workerStand[2])).toBeLessThan(.3);
      expect(grip[1]).toBeGreaterThan(layout.workHeight);
      expect(grip[1]).toBeLessThan(.56);
    }
    const original = createRomanBuildingRecipe(getBuildingDefinition(6), true, false);
    const built = decorateExpansionDrinkMaker(original, 6, nation, true);
    const added = built.parts.filter(part => !original.parts.includes(part));
    const [x, , z] = layout.workerStand;
    expect(added.filter(part => {
      const box = getRomanPartBounds(part);
      return box.min[0] < x + .095 && box.max[0] > x - .095 &&
        box.min[2] < z + .095 && box.max[2] > z - .095 && box.min[1] < .65 && box.max[1] > .025;
    }), nation).toEqual([]);
  }
});
