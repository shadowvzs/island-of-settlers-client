import { expect, it } from "vitest";

import { advancedMaterialBase } from "../src/render-common/buildings/advanced-material-buildings";
import { BUILDING_CATALOG, getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getRomanStaticRecipeBounds } from "../src/render-common/buildings/building-placement-envelope";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanRecipeBounds, getRomanRecipeFitScale } from "../src/render-common/buildings/building-recipe-fit";
import { BUILDING_PLOT_MARGIN, getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { DEFAULT_ROMAN_DOOR } from "../src/render-common/buildings/roman-door-profile";
import { ROMAN_MILL_ROTOR_HALF_DEPTH,ROMAN_MILL_ROTOR_RADIUS } from "../src/render-common/buildings/roman-mill-dimensions";
import { STORAGE_DOUBLE_DOOR, usesStorageDoubleDoor } from "../src/render-common/buildings/storage-door-profile";
import { WORKER_HEIGHT, WORKER_RADIUS, WORKER_SCALE } from "../src/render-common/workers/worker-dimensions";

it("keeps the existing settler scale and collision radius", () => {
  expect(WORKER_HEIGHT).toBe(1.0625);
  expect(WORKER_SCALE).toBe(1.0625 / 1.16);
  expect(WORKER_RADIUS).toBe(0.2);
});

it.each(BUILDING_CATALOG)("$name uses one exact uniform scale and a cached containing plot", (definition) => {
  const sizing = getRomanBuildingWorldSizing(definition);
  expect(getRomanBuildingWorldSizing(definition)).toBe(sizing);
  // The footprint is the stored geometry sidecar; it equals the recipe sizing (contract test).
  expect(definition.gridFootprint).toEqual(sizing.cells);
  const workerScale = getRomanRecipeFitScale(definition, createRomanBuildingRecipe(definition, false));
  expect(sizing.scale).toBeGreaterThanOrEqual(workerScale);
  if (!sizing.policy.fillLargeModel) expect(sizing.scale).toBe(workerScale);
  if (definition.style === "well") {
    expect(sizing.cells).toEqual([2, 2]);
    expect(sizing.scale).toBeLessThanOrEqual(1);
    return;
  }
  for (const detailed of [true, false]) {
    const recipe = createRomanBuildingRecipe(definition, detailed);
    const bounds = [1, 20, 31].includes(advancedMaterialBase(definition.id) ?? definition.id) ? getRomanStaticRecipeBounds(recipe) : getRomanRecipeBounds(definition, recipe, false);
    expect(bounds.width * sizing.scale + BUILDING_PLOT_MARGIN).toBeLessThanOrEqual(sizing.cells[0]);
    expect(bounds.depth * sizing.scale + BUILDING_PLOT_MARGIN).toBeLessThanOrEqual(sizing.cells[1]);
  }
  if (definition.id === 7) {
    expect(sizing.scale).toBe(1); expect(sizing.cells).toEqual([9, 9]);
    expect(sizing.recipe.hideDoor).toBe(true); // Exterior service only; no staffed interior.
    return;
  }
  if (definition.id === 16) {
    // The Catapult Tower authors its own narrow military doorway; no shared civilian door applies.
    expect(sizing.recipe.doorDimensions).toBeUndefined();
  } else {
    const doorWidth = usesStorageDoubleDoor(definition.id)
      ? STORAGE_DOUBLE_DOOR.width : DEFAULT_ROMAN_DOOR.width;
    expect(sizing.recipe.doorDimensions).toEqual({ ...DEFAULT_ROMAN_DOOR, width: doorWidth });
  }
  expect(sizing.recipe.doubleDoor ?? false).toBe(usesStorageDoubleDoor(definition.id));
  expect(sizing.scale).toBeGreaterThan(1);
  expect(sizing.cells).toEqual([
    Math.max(sizing.policy.minimum[0], Math.ceil(sizing.groundBounds.width * sizing.scale + BUILDING_PLOT_MARGIN - 1e-9)),
    Math.max(sizing.policy.minimum[1], Math.ceil(sizing.groundBounds.depth * sizing.scale + BUILDING_PLOT_MARGIN - 1e-9))
  ]);
  const headroom = sizing.recipe.doorProfile === "arched" ? DEFAULT_ROMAN_DOOR.spring : DEFAULT_ROMAN_DOOR.height;
  expect(headroom * sizing.scale).toBeGreaterThanOrEqual(WORKER_HEIGHT + 0.0575 - 1e-9);
  if (!sizing.policy.fillLargeModel) expect(headroom * sizing.scale).toBeCloseTo(WORKER_HEIGHT + 0.0575, 10);
});

it("gives the mill a compact stock-and-masonry plot with a separate safe overhead sweep", () => {
  const sizing = getRomanBuildingWorldSizing(getBuildingDefinition(31));
  const sweptRadius = ROMAN_MILL_ROTOR_RADIUS * sizing.scale;
  expect(sizing.cells).toEqual([5, 4]);
  expect(sizing.cells[0] / 2).toBeLessThan(sweptRadius);
  expect(sizing.overhead).toEqual([{ kind: "vertical-rotor", center: sizing.recipe.mechanism, radius: ROMAN_MILL_ROTOR_RADIUS, halfDepth: ROMAN_MILL_ROTOR_HALF_DEPTH }]);
  expect(sizing.recipe.mechanism[1] * sizing.scale - sweptRadius).toBeGreaterThan(WORKER_HEIGHT);
});
