import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { withIndigenousTextileStyle } from "../src/render-common/buildings/indigenous-textile-styles";
import { createLevelPlanRecipe, createNationBuildingRecipe }
  from "../src/render-common/buildings/nation-building-recipe";
import { listBuildingSurfacePaints, paintBuildingSurface }
  from "../src/renderers/three/buildings/building-surface-paint";

it("gives occupations genuinely different painted layouts without allocating their atlases to other nations", () => {
  const own = listBuildingSurfacePaints("indigenous", false).filter(paint =>
    ["hide", "hide-hunt", "hide-mountains", "hide-reeds", "hide-sun"].includes(paint.surface)
      && paint.nation === "indigenous");
  expect(own).toHaveLength(5);
  const pixels = own.map(paint => paintBuildingSurface({ ...paint, resolution: 64 })[0]!);
  for (let a = 0; a < pixels.length; a++) for (let b = a + 1; b < pixels.length; b++) {
    let differences = 0;
    for (let index = 0; index < pixels[a]!.length; index += 4)
      if (Math.abs(pixels[a]![index]! - pixels[b]![index]!)
        + Math.abs(pixels[a]![index + 1]! - pixels[b]![index + 1]!) > 5) differences++;
    expect(differences).toBeGreaterThan(4);
    expect(differences, "paint should leave most sewn hide uncovered").toBeLessThan(300);
  }
  for (const surface of ["hide-mountains", "cloth-patched", "cloth-hide-trim"])
    expect(listBuildingSurfacePaints("japanese", true).some(paint => paint.surface === surface)).toBe(false);
});

it("keeps stores, gameplay anchors and specialist fabrics intact while matching styles across LODs", () => {
  for (const id of [2, 4, 6, 9, 14, 17, 18, 19, 20, 35, 57, 58]) {
    const definition = BUILDING_CATALOG.find(building => building.id === id)!;
    const styles = [true, false].map(detailed => {
      const original = createLevelPlanRecipe(definition, detailed, 1).plan;
      const painted = withIndigenousTextileStyle(original, id);
      expect(painted.parts.filter(part => part.stock)).toEqual(original.parts.filter(part => part.stock));
      const { parts: unused, ...contacts } = original;
      void unused;
      const { parts: changed, ...after } = painted;
      void changed;
      expect(after).toEqual(contacts);
      const built = createNationBuildingRecipe(definition, "indigenous", detailed);
      expect(built.parts.filter(part => part.surface.startsWith("hide-")).length,
        "one small painted cover per building, not repeated on every tower").toBeLessThanOrEqual(1);
      return new Set(built.parts
        .filter(part => !part.stock && (part.surface.startsWith("cloth") || part.surface.startsWith("hide")))
        .map(part => part.surface));
    });
    expect(styles[0]).toEqual(styles[1]);
    if (id === 17) expect(styles[0]!.has("cloth-patched")).toBe(true);
    if (id === 18) expect(styles[0]!.has("cloth-hide-trim")).toBe(true);
    if (id === 35) expect(styles[0]!.has("cloth-water")).toBe(false);
  }
});

it("supports a foot-sized patch at every unchanged fortress archer position", () => {
  const definition = BUILDING_CATALOG.find(building => building.id === 9)!;
  for (const detailed of [true, false]) {
    const recipe = createNationBuildingRecipe(definition, "indigenous", detailed);
    for (const [x, y, z] of recipe.archerPositions!) for (const dx of [-.085, 0, .085])
      for (const dz of [-.075, 0, .075]) {
        const standing = recipe.parts.filter(part => part.surface === "planks" && !part.rotation
          && Math.abs(part.position[1] + part.size[1] / 2 - y) < .001);
        expect(standing.some(part => {
          const { max, min } = getRomanPartBounds(part);
          return x + dx >= min[0] - .008 && x + dx <= max[0] + .008
            && z + dz >= min[2] - .008 && z + dz <= max[2] + .008;
        }), `${detailed}: archer foot ${x + dx}/${y}/${z + dz}`).toBe(true);
      }
  }
});
