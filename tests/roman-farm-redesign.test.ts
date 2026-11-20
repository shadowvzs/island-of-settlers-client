import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";

it.each([true, false])(
  "farm has a taller barn and lower attached sheltered harvest bay (high=%s)",
  (detailed) => {
    const recipe = createRomanBuildingRecipe(getBuildingDefinition(37), detailed);
    const roofSlabs = recipe.parts.filter(
      (part) =>
        ["roof-thatch", "roof-shingles"].includes(part.surface) &&
        part.shape === "box" && part.size[0] > .5 && part.size[2] > .5 &&
        part.rotation &&
        Math.abs(part.rotation[2]) > 0.3
    );
    expect(roofSlabs).toHaveLength(4);
    const upper = roofSlabs.filter((part) => Math.abs(part.rotation![2]) > 0.6);
    expect(upper).toHaveLength(2);
    expect(Math.min(...upper.map((part) => part.position[1]))).toBeGreaterThan(
      Math.max(
        ...roofSlabs.filter((part) => !upper.includes(part)).map((part) => part.position[1])
      ) + 0.3
    );
    const posts = recipe.parts.filter((part) => part.surface === "wood" && part.size[1] === 1.02);
    expect(posts).toHaveLength(2);
    expect(posts.every((part) => part.position[1] - part.size[1] / 2 < 0.001)).toBe(true);
    expect(getRomanBuildingWorldSizing(getBuildingDefinition(37)).cells).toEqual([6, 6]);
  }
);

it.each([true, false])(
  "farm's six independent wheat bundles stay right of the entrance (high=%s)",
  (detailed) => {
    const recipe = createRomanBuildingRecipe(getBuildingDefinition(37), detailed);
    const bundles = recipe.parts.filter((part) => part.stock?.ware === "grain");
    expect([...new Set(bundles.map((part) => part.stock!.slot))].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5
    ]);
    expect(bundles.every((part) => part.position[0] > recipe.door[0] + 0.46 + 0.1)).toBe(true);
    for (let slot = 0; slot < 6; slot++) {
      const pieces = bundles.filter((part) => part.stock!.slot === slot);
      expect(pieces.some((part) => part.shape === "wheat-stalk")).toBe(true);
      expect(Math.min(...pieces.map((part) => part.position[1]))).toBeLessThan(0.11);
    }
    const blade = recipe.parts.find((part) => part.shape === "scythe-blade")!;
    expect(blade.surface).toBe("steel");
    expect(blade.size[0]).toBeGreaterThan(0.4);
    expect(blade.position[0] + blade.size[0] / 2).toBeLessThan(recipe.door[0]);
    expect(recipe.parts.some((part) => part.surface === "stone" && part.stage === 0)).toBe(false);
  }
);
