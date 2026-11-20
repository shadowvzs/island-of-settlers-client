import { expect, it } from "vitest";

import type { BuildingPart, BuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { withBuildingWindowFinish } from "../src/render-common/buildings/building-window-finish";
import { windowGarrisonAnchors } from "../src/render-common/buildings/military-window-slots";
import { createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";

const pane: BuildingPart = { shape: "box", surface: "dark", position: [0, .8, 1], size: [.3, .4, .018], stage: 2 };
const frame: BuildingPart = { shape: "box", surface: "wood", position: [.17, .8, 1.02], size: [.04, .46, .06], stage: 2 };

it("changes finishes without replacing panes, opening geometry, routes or window-garrison contracts", () => {
  const recipe = { parts: [pane, frame], door: [0, 0, 1] } as BuildingRecipe;
  const before = structuredClone(recipe), finished = withBuildingWindowFinish(recipe, "roman");
  expect(recipe).toEqual(before);
  expect(windowGarrisonAnchors(finished.parts)).toEqual(windowGarrisonAnchors(before.parts));
  expect(finished.door).toEqual(before.door);
  expect(finished.parts.map(({ tint: _tint, ...part }) => part)).toEqual(before.parts);
  expect(finished.parts[0]!.surface).toBe("dark");
  expect(finished.parts[0]!.tint).toBeUndefined(); // The canonical alpha-black pass owns panes.
  expect(finished.parts[1]!.tint).not.toEqual([1, 1, 1]);
});

it("shades actual inward wall faces gently while keeping exterior colour and mesh topology intact", () => {
  const wall: BuildingPart = { shape: "box", surface: "plaster", position: [0, .8, 1], size: [2, 1.6, .16], stage: 1 };
  const recipe = { parts: [wall] } as BuildingRecipe;
  const shaded = withBuildingWindowFinish(recipe, "persian").parts[0]!;
  const old = createRomanPartGeometry(wall, true), actual = createRomanPartGeometry(shaded, true);
  try {
    expect(Array.from(actual.getAttribute("position").array)).toEqual(Array.from(old.getAttribute("position").array));
    expect(actual.index?.count).toBe(old.index?.count);
    const normals = actual.getAttribute("normal"), colours = actual.getAttribute("color");
    let inward = 0, outward = 0;
    for (let index = 0; index < normals.count; index++) {
      if (normals.getZ(index) < -.9) { expect(colours.getX(index)).toBeCloseTo(.72); inward++; }
      if (normals.getZ(index) > .9) { expect(colours.getX(index)).toBe(1); outward++; }
      expect(colours.getZ(index)).toBeGreaterThanOrEqual(.7);
    }
    expect(inward).toBeGreaterThan(0); expect(outward).toBeGreaterThan(0);
  } finally { old.dispose(); actual.dispose(); }
});
