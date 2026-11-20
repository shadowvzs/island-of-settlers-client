import { expect, it } from "vitest";

import { BUILDING_CATALOG, getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingPart, BuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { createOpeningShadowDisk, withBuildingWindowShadows } from "../src/render-common/buildings/building-window-shadows";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { romanFurnaceAnchors } from "../src/render-common/buildings/roman-furnaces";
import { createWindowShadowGeometry } from "../src/renderers/three/buildings/window-shadow-geometry";

it("converts explicitly authored firebox/flue openings without making adjacent fuel or hardware transparent", () => {
  const opening: BuildingPart = { position: [0, 1.2, 0], size: [.24, .014, .25], stage: 3,
    shape: "window-shadow", surface: "dark" };
  const fuel: BuildingPart = { ...opening, shape: "rock", position: [0, .2, 0], size: [.1, .1, .1] };
  const actual = withBuildingWindowShadows({ parts: [opening, fuel] } as BuildingRecipe);
  expect(actual.parts[0]!.windowShadow).toBe(true);
  expect(actual.parts[0]!.size[1]).toBe(.001);
  expect(actual.parts[1]).toBe(fuel);
  const anchors = romanFurnaceAnchors(getBuildingDefinition(32), { ...actual, mechanism: [0, 0, 0] });
  expect(anchors!.smoke).toEqual([0, 1.22, 0]);
});

it("draws a shaft depth as one horizontal circular surface instead of overlapping cylinder caps", () => {
  const disk = createOpeningShadowDisk({ position: [0, .2, 0], size: [.5, .02, .5],
    shape: "cylinder", surface: "dark", stage: 1 }, true);
  const geometry = createWindowShadowGeometry(disk);
  try {
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.max.y - geometry.boundingBox!.min.y).toBeLessThan(.000001);
    expect(geometry.boundingBox!.max.z - geometry.boundingBox!.min.z).toBeCloseTo(1);
    expect(geometry.index!.count / 3).toBe(22);
    expect(disk.windowShadowDecorative).toBe(true);
  } finally { geometry.dispose(); }
});

it("keeps the named mill, bakery and national well depth backings semantic in both detail tiers and levels 1–5", () => {
  const well = BUILDING_CATALOG.find(definition => definition.style === "well")!;
  for (const detailed of [true, false]) for (const level of [1, 2, 3, 4, 5] as const) {
    for (const nation of ["roman", "japanese", "chinese", "persian", "nubian", "indigenous", "viking"] as const) {
      const recipe = leveledBuildingRecipe(well, nation, detailed, level);
      expect(recipe.parts.some(part => part.windowShadowContour && part.size[1] === .001), `${nation}/${level}/shaft`).toBe(true);
    }
    for (const id of detailed ? [20, 22] : [20]) {
      const recipe = leveledBuildingRecipe(getBuildingDefinition(id), "viking", detailed, level);
      expect(recipe.parts.some(part => part.windowShadow), `viking/${id}/${level}`).toBe(true);
    }
    const mill = leveledBuildingRecipe(getBuildingDefinition(31), "chinese", detailed, level);
    expect(mill.parts.some(part => part.windowShadow && part.windowOpeningSize?.[0] === .28), `mill/${level}`).toBe(true);
    for (const nation of ["chinese", "indigenous"] as const) {
      const bakery = leveledBuildingRecipe(getBuildingDefinition(32), nation, detailed, level);
      expect(bakery.parts.some(part => part.windowShadow && part.windowOpeningSize?.[0] === .34), `${nation}/bakery/${level}`).toBe(true);
    }
  }
});
