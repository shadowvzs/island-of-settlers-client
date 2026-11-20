import type { WorkerNation } from "../workers/worker-nation";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import type { AddPart } from "./roman-resource-workshops";

export const addLookoutSpyglassPainting = (part: AddPart, x: number, y: number, z: number) =>
  part("paint", [x, y, z + .026], [.165, .165, .001], 3, "lookout-spyglass-sign", undefined, [1, 1, 1]);

/** Open Indigenous lookouts discard inherited masonry tablets; hang one from an actual front rail. */
export const withLookoutSpyglassSign = (recipe: BuildingRecipe, type: number, nation: WorkerNation): BuildingRecipe => {
  if (type !== 14 || recipe.parts.some(part => part.shape === "lookout-spyglass-sign")) return recipe;
  const rails = recipe.parts.filter(part => !part.stock && ["wood", "planks"].includes(part.surface))
    .map(part => ({ part, bounds: getRomanPartBounds(part) }))
    .filter(({ bounds }) => bounds.max[0] - bounds.min[0] > .36 &&
      bounds.max[1] - bounds.min[1] < .14 && bounds.min[1] > 1 && bounds.max[2] >= recipe.door[2] - .25)
    .sort((a, b) => b.bounds.max[2] - a.bounds.max[2] || a.bounds.min[1] - b.bounds.min[1]);
  const rail = rails[0];
  if (!rail) throw new Error(`Lookout ${nation} has no backed sign support`);
  const x = (rail.bounds.min[0] + rail.bounds.max[0]) / 2;
  const y = (rail.bounds.min[1] + rail.bounds.max[1]) / 2, z = rail.bounds.max[2];
  const parts: BuildingPart[] = [...recipe.parts];
  const add = (shape: BuildingPart["shape"], position: Point3, size: Point3, surface: BuildingPart["surface"]) =>
    parts.push({ shape, position, size, surface, stage: 3, occupationSign: true });
  add("bevel-box", [x, y - .12, z + .025], [.31, .18, .045], "wood");
  for (const side of [-1, 1]) add("box", [x + side * .10, y - .02, z + .01], [.014, .05, .04], "rope");
  add("lookout-spyglass-sign", [x, y - .12, z + .0485], [.165, .165, .001], "paint");
  return { ...recipe, parts };
};
