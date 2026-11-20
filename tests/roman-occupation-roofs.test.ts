import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { type BuildingPart, createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds, getRomanRecipeBounds } from "../src/render-common/buildings/building-recipe-fit";
import { withRomanMasonryTextureScale } from "../src/render-common/buildings/building-texture-scale";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { ROMAN_OCCUPATION_ROOF_IDS } from "../src/render-common/buildings/roman-occupation-roofs";
import { createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";

/** Window parts lie in the mill's leaning front wall: a small backward tilt about X only. */
const isMillWindowPart = (part: BuildingPart) => {
  const [lean = 0, yaw = 0, roll = 0] = part.rotation ?? [];
  return lean < -.05 && lean > -.2 && yaw === 0 && roll === 0 && part.position[2] > .3;
};

it.each(ROMAN_OCCUPATION_ROOF_IDS)("preserves building %s access, stock and original plot", id => {
  const definition = getBuildingDefinition(id);
  for (const detailed of [true, false]) {
    const before = createRomanBuildingRecipe(definition, detailed, false);
    const after = createRomanBuildingRecipe(definition, detailed);
    const {parts: oldParts, ...oldAnchors} = before, {parts, ...anchors} = after;
    expect(anchors).toEqual(oldAnchors);
    expect(parts.filter(part => part.stock)).toEqual(oldParts.filter(part => part.stock));
    expect(getRomanBuildingWorldSizing(definition).cells).toEqual(definition.gridFootprint);
    const previousBounds = getRomanRecipeBounds(definition, before);
    const bounds = getRomanRecipeBounds(definition, after);
    expect(bounds.extentX).toBeLessThanOrEqual(previousBounds.extentX + .00001);
    expect(bounds.extentZ).toBeLessThanOrEqual(previousBounds.extentZ + .00001);
    for (const part of parts.filter(piece => piece.shape === "occupation-roof")) {
      const geometry = createRomanPartGeometry(part, detailed);
      geometry.computeBoundingBox();
      const expected = getRomanPartBounds(part), actual = geometry.boundingBox!;
      expect(actual.min.y).toBeGreaterThanOrEqual(expected.min[1] - .00001);
      expect(actual.max.y).toBeLessThanOrEqual(expected.max[1] + .00001);
      geometry.dispose();
    }
  }
});

it("retains protected HQ/harbour recipes and unselected architecture", () => {
  for (const id of [0, 1, 21, 25, 28, 31, 32, 36, 39]) {
    for (const detailed of [true, false]) {
      const definition = getBuildingDefinition(id);
      const baseline = createRomanBuildingRecipe(definition, detailed, false);
      const expected = structuredClone(baseline);
      // Displayed masonry is texture-mapped to scale; the geometry stays exact.
      expected.parts = withRomanMasonryTextureScale(expected.parts);
      const displayed = createRomanBuildingRecipe(definition, detailed);
      // The owner-approved Roman mill window (2026-10-20) is the mill's only Roman-finish addition.
      const window = displayed.parts.filter(part => id === 31 && isMillWindowPart(part));
      const millWindowParts = detailed ? 5 : 1;
      expect(window).toHaveLength(id === 31 ? millWindowParts : 0);
      displayed.parts = displayed.parts.filter(part => !window.includes(part));
      expect(displayed).toEqual(expected);
      // Display filtering must never mutate the authoritative sizing/rollback recipe.
      expect(createRomanBuildingRecipe(definition, detailed, false)).toEqual(baseline);
    }
  }
});

