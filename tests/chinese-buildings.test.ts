import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds, getRomanRecipeBounds } from "../src/render-common/buildings/building-recipe-fit";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { createChineseBuildingRecipe } from "../src/render-common/buildings/chinese-building-recipe";
import { chineseRoofProfile } from "../src/render-common/buildings/chinese-building-roofs";
import { roofTopAt } from "../src/render-common/buildings/levels/level-roof-surface";
import { militaryTowerPlans } from "../src/render-common/buildings/military-tower-plan";
import { ROMAN_HARBOR_BEACON_POSITION } from "../src/render-common/buildings/roman-harbor";
import { WORKER_HEIGHT } from "../src/render-common/workers/worker-dimensions";

it("preserves the complete Chinese occupation roster's anchors, inventory and horizontal envelope", () => {
  for (const detailed of [true, false]) for (const definition of BUILDING_CATALOG) {
    const original = createRomanBuildingRecipe(definition, detailed, false);
    const built = createChineseBuildingRecipe(original, definition, detailed);
    const { flagAnchor: originalFlag, parts: originalParts, ...originalAnchors } = original;
    const { flagAnchor, parts, ...anchors } = built;
    expect(anchors, `${definition.id}/anchors`).toEqual(originalAnchors);
    if (definition.id === 0 && originalFlag) {
      expect(flagAnchor).toEqual([0, roofTopAt(parts, 0, 0, detailed)! + .20, 0]);
    } else expect(flagAnchor).toEqual(originalFlag);
    expect(parts.filter(part => part.stock), `${definition.id}/stocks`)
      .toEqual(originalParts.filter(part => part.stock));
    const before = getRomanRecipeBounds(definition, original), after = getRomanRecipeBounds(definition, built);
    expect(after.extentX, `${definition.id}/x`).toBeLessThanOrEqual(before.extentX + .0001);
    expect(after.extentZ, `${definition.id}/z`).toBeLessThanOrEqual(before.extentZ + .0001);
    expect(parts.every(part => [...part.position, ...part.size].every(Number.isFinite))).toBe(true);
    expect(parts.every(part => part.size.every(size => size > 0))).toBe(true);
    expect(parts.some(part => part.shape === "civic-statue" || part.shape === "tile")).toBe(false);
  }
});

it("leaves every working Chinese building's entrance approach open", () => {
  for (const detailed of [true, false]) for (const definition of BUILDING_CATALOG) {
    if (definition.style === "well" || definition.id === 7) continue;
    const original = createRomanBuildingRecipe(definition, detailed, false);
    const built = createChineseBuildingRecipe(original, definition, detailed);
    const centre = built.door[0] + (built.doorDimensions?.width ?? .46) / 2;
    const front = built.door[2] - .016;
    const blocked = built.parts.filter(part => {
      if (part.shape === "stone-arc") return false;
      const { max, min } = getRomanPartBounds(part);
      return min[0] < centre + .31 && max[0] > centre - .31 && min[1] < .82 && max[1] > .025 &&
        min[2] < front + .95 && max[2] > front + .19;
    });
    expect(blocked, `${definition.id}/${detailed}/approach`).toEqual([]);
  }
});

it("uses multiple roof constructions and a broad gate landmark", () => {
  expect(new Set([0, 17, 18].map(chineseRoofProfile)).size).toBe(3);
  const definition = BUILDING_CATALOG.find(building => building.id === 7)!;
  const original = createRomanBuildingRecipe(definition, true, false);
  const landmark = createChineseBuildingRecipe(original, definition, true);
  expect(landmark.hideDoor).toBe(true);
  expect(landmark.parts.filter(part => part.shape === "occupation-roof")).toHaveLength(1);
  expect(landmark.parts.some(part => part.shape === "civic-statue")).toBe(false);
});

it("rebuilds mine headframes and keeps a sealed harbour belfry support on High", () => {
  for (const id of [10, 11, 12, 13, 39]) {
    const definition = BUILDING_CATALOG.find(building => building.id === id)!;
    const original = createRomanBuildingRecipe(definition, true, false);
    const built = createChineseBuildingRecipe(original, definition, true);
    const arcs = built.parts.filter(part => part.shape === "stone-arc" && part.size[0] > .65);
    if (id === 39) {
      const [towerX, , towerZ] = ROMAN_HARBOR_BEACON_POSITION;
      const shell = built.parts.find(part => part.shape === "cylinder" && part.surface === "plaster" &&
        Math.hypot(part.position[0] - towerX, part.position[2] - towerZ) < .01 && part.size[1] > 2);
      expect(shell, "harbour belfry support").toBeDefined();
      expect(arcs, "gapped ashlar courses replaced by the shell").toEqual([]);
    } else {
      expect(arcs, `${id}/classical tunnel removed`).toEqual([]);
      expect(built.parts.some(part => part.shape === "occupation-roof" && part.position[1] > 1.2)).toBe(true);
      expect(built.parts.filter(part => part.surface === "wood" && part.size[1] >= 1.2).length).toBeGreaterThanOrEqual(4);
    }
  }
});

it("wraps the Chinese tower eave with a curved timber fascia", () => {
  const definition = BUILDING_CATALOG.find(building => building.id === 4)!;
  for (const detailed of [true, false]) {
    const original = createRomanBuildingRecipe(definition, detailed, false);
    const built = createChineseBuildingRecipe(original, definition, detailed);
    const eave = Math.min(...built.parts.filter(part => part.occupationRoof === "pyramid")
      .map(part => getRomanPartBounds(part).min[1]));
    const fascia = built.parts.filter(part => part.roofSupport && part.stage === 3 && part.surface === "paint");
    expect(fascia.length, `${detailed}: two sides × curved segments`).toBe(detailed ? 8 : 4);
    expect(fascia.every(part => getRomanPartBounds(part).max[1] > eave + .02),
      `${detailed}: fascia follows the raised eave`).toBe(true);
  }
});

it("covers every fortress tower while retaining full standing headroom and the original soldier posts", () => {
  const definition = BUILDING_CATALOG.find(building => building.id === 9)!;
  const { scale } = getRomanBuildingWorldSizing(definition);
  for (const detailed of [true, false]) {
    const original = createRomanBuildingRecipe(definition, detailed, false);
    const built = createChineseBuildingRecipe(original, definition, detailed);
    expect(built.archerPositions).toEqual(original.archerPositions);
    for (const plan of militaryTowerPlans(9, original)) {
      const roof = built.parts.find(part => part.shape === "occupation-roof" &&
        Math.abs(part.position[0] - plan.x) < .001 && Math.abs(part.position[2] - plan.z) < .001);
      expect(roof, `${plan.kind}/${plan.x}/${plan.z}`).toBeDefined();
      expect((getRomanPartBounds(roof!).min[1] - plan.deck) * scale).toBeGreaterThan(WORKER_HEIGHT + .1);
    }
  }
});
