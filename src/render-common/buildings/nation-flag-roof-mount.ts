import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { roofTopAt } from "./levels/level-roof-surface";
import { type Add, runBetween } from "./nation-kit-parts";

/** Extend a detached canonical flag mast down to the actual roof skin, without moving its animation. */
export const withRoofFlagMount = (recipe: BuildingRecipe, detailed: boolean): BuildingRecipe => {
  if (!recipe.flagAnchor) return recipe;
  const [x, anchorY, z] = recipe.flagAnchor;
  // The shared animated flag's .64 mast is centred .12 above its anchor: its foot is anchor-.20.
  const foot = anchorY - .20;
  const capParts = recipe.parts.filter(part => !part.stock &&
    ["wood", "planks", "stone", "cut-stone", "plaster"].includes(part.surface) &&
    part.shape === "box" && part.size[1] < .2 && getRomanPartBounds(part).max[1] > .85)
    .map(part => ({ ...part, roofSupport: true as const }));
  // Flat masonry terraces may be structural caps rather than tagged roof skins.
  const roof = roofTopAt(recipe.parts, x, z, detailed) ?? roofTopAt(capParts, x, z, detailed);
  if (roof === null || foot <= roof + .012) return recipe;
  if (recipe.parts.some(part => !part.stock && part.surface === "wood" &&
    Math.abs(part.position[0] - x) < .001 && Math.abs(part.position[2] - z) < .001 &&
    Math.max(part.size[0], part.size[2]) < .06 && getRomanPartBounds(part).min[1] <= roof + .005 &&
    getRomanPartBounds(part).max[1] >= foot)) return recipe;
  const parts: BuildingPart[] = [...recipe.parts];
  const add: Add = part => parts.push({ stage: 3, ...part });
  const bottom = roof - .025, top = foot + .015;
  add({ position: [x, (bottom + top) / 2, z], shape: "bevel-box", size: [.032, top - bottom, .032],
    stage: 3, surface: "wood" });
  // A small roof shoe and binding collar carry the mast through the tiles to the roof timbers.
  add({ position: [x, roof + .012, z], shape: "bevel-box", size: [.085, .045, .085], surface: "wood" });
  add({ position: [x, roof + .055, z], radialSegments: detailed ? 8 : 4, shape: "ring",
    size: [.048, .025, .048], surface: "iron" });
  const braceTop = Math.min(foot - .035, roof + .18);
  for (const side of [-1, 1]) {
    const bx = x + side * .105, support = roofTopAt(recipe.parts, bx, z, detailed);
    if (support === null || support >= braceTop - .025) continue;
    const from: Point3 = [bx, support + .008, z], to: Point3 = [x, braceTop, z];
    runBetween(add, from, to, [.022, .022], { shape: "bevel-box", stage: 3, surface: "wood" });
  }
  return { ...recipe, parts };
};
