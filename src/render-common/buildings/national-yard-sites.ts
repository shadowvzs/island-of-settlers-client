import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { getRomanBuildingWorldSizing } from "./building-world-sizing";
import { getRomanWareStockPresentationParts, getRomanWareStockSlots } from "./roman-ware-stock";

export interface YardDecorationBounds { max: Point3; min: Point3 }
const overlap = (a: YardDecorationBounds, b: YardDecorationBounds, gap: number) =>
  [0, 1, 2].every(axis => a.min[axis]! < b.max[axis]! + gap && a.max[axis]! > b.min[axis]! - gap);
const segmentDistance = (point: Point3, from: Point3, to: Point3) => {
  const dx = to[0] - from[0], dz = to[2] - from[2], length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[2] - from[2]) * dz) / length)) : 0;
  return Math.hypot(point[0] - from[0] - dx * t, point[2] - from[2] - dz * t);
};
const boxAt = (point: Point3, size: Point3): YardDecorationBounds => ({
  max: [point[0] + size[0] / 2, point[1] + size[1], point[2] + size[2] / 2],
  min: [point[0] - size[0] / 2, point[1], point[2] - size[2] / 2],
});

/** Every possible mixed input/output presentation is reserved, including the currently empty slots. */
export const fullYardStockBounds = (recipe: BuildingRecipe, definition: BuildingDefinition) => {
  const { scale } = getRomanBuildingWorldSizing(definition);
  const wares = new Set(recipe.parts.flatMap(part => part.stock ?
    [part.stock.ware, ...(part.stock.wares ?? [])] : []));
  const parts = [...wares].flatMap(ware =>
    getRomanWareStockPresentationParts(recipe, scale, true, ware).filter(part => part.stock));
  return parts.map(part => getRomanPartBounds(part));
};

const flatGround = (parts: readonly BuildingPart[], point: Point3, size: Point3) => {
  let height = 0;
  for (const part of parts) {
    if (part.stock || part.rotation?.some(value => Math.abs(value) > .0001) ||
      part.topOffset || part.topScale || !["box", "bevel-box"].includes(part.shape)) continue;
    const { max, min } = getRomanPartBounds(part);
    if (min[1] > .02 || max[1] > .18 || max[1] < 0) continue;
    if (min[0] <= point[0] - size[0] / 2 - .01 && max[0] >= point[0] + size[0] / 2 + .01 &&
      min[2] <= point[2] - size[2] / 2 - .01 && max[2] >= point[2] + size[2] / 2 + .01)
      height = Math.max(height, max[1]);
  }
  return height;
};

/** Reusable conservative ground placement: reject a crowded yard instead of moving any original prop. */
export const findFreeNationalYardSpot = (recipe: BuildingRecipe, definition: BuildingDefinition,
  limit: { extentX: number; extentZ: number }, size: Point3): Point3 | null => {
  const architecture = recipe.parts.map(part => getRomanPartBounds(part)), stocks = fullYardStockBounds(recipe, definition);
  const { scale } = getRomanBuildingWorldSizing(definition);
  const slots = getRomanWareStockSlots(recipe, scale), radius = Math.hypot(size[0], size[2]) / 2;
  const doorCentre = recipe.door[0] + (recipe.doorDimensions?.width ?? .46) / 2;
  const threshold: Point3 = [doorCentre, 0, recipe.door[2]];
  const anchors = [recipe.workerExit, recipe.workPoint, recipe.mechanism];
  const candidates: Point3[] = [];
  const nx = Math.max(1, Math.ceil(limit.extentX * 2 / .12)), nz = Math.max(1, Math.ceil(limit.extentZ * 2 / .12));
  for (let iz = 0; iz <= nz; iz++) for (const side of [1, -1]) for (let inward = 0; inward < 4; inward++) {
    const x = side * (limit.extentX - size[0] / 2 - .025 - inward * limit.extentX / nx);
    const z = -limit.extentZ + size[2] / 2 + .025 + iz / nz * (limit.extentZ * 2 - size[2] - .05);
    candidates.push([x, 0, z]);
  }
  for (const candidate of candidates) {
    const ground = flatGround(recipe.parts, candidate, size), at: Point3 = [candidate[0], ground, candidate[2]];
    const box = boxAt(at, size);
    if (box.min[0] < -limit.extentX || box.max[0] > limit.extentX ||
      box.min[2] < -limit.extentZ || box.max[2] > limit.extentZ) continue;
    if (box.min[0] < doorCentre + .6 && box.max[0] > doorCentre - .6 &&
      box.max[2] > threshold[2] - .15 && box.min[2] < recipe.workerExit[2] + .4) continue;
    if (anchors.some(anchor => Math.hypot(at[0] - anchor[0], at[2] - anchor[2]) < radius + .55)) continue;
    if (segmentDistance(at, threshold, recipe.workerExit) < radius + .3 ||
      segmentDistance(at, recipe.workerExit, recipe.workPoint) < radius + .3) continue;
    if (slots.some(slot => segmentDistance(at, recipe.workerExit, slot.center) < radius + .32)) continue;
    if (architecture.some(other => other.max[1] > ground + .004 && overlap(box, other, .035))) continue;
    if (stocks.some(other => overlap(box, { max: [other.max[0] + .35, other.max[1] + .3, other.max[2] + .35],
      min: [other.min[0] - .35, 0, other.min[2] - .35] }, .015))) continue;
    return at;
  }
  return null;
};
