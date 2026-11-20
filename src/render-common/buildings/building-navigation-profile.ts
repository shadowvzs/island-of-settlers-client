import { WORKER_HEIGHT } from "../workers/worker-dimensions";
import type { WorkerNation } from "../workers/worker-unit";
import { getBuildingDefinition } from "./building-catalog";
import type { BuildingNavigationVolume } from "./building-navigation-types";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { getRomanBuildingWorldSizing } from "./building-world-sizing";
import type { BuildingLevel } from "./levels/building-level";
import { leveledBuildingRecipe } from "./levels/leveled-building-recipe";
import { getRomanWareStockInventoryParts } from "./roman-ware-stock";

export interface BuildingNavigationProfile {
  recipe: BuildingRecipe;
  scale: number;
  interiors: readonly BuildingNavigationVolume[];
  obstacles: readonly BuildingNavigationVolume[];
}
const profiles = new Map<string, BuildingNavigationProfile>();
const coordinateScale = (point: Point3, scale: number) => point.map(value => value * scale) as Point3;
const scaledVolume = (volume: BuildingNavigationVolume, scale: number): BuildingNavigationVolume => ({
  ...volume, min: coordinateScale(volume.min, scale), max: coordinateScale(volume.max, scale)
});
const partVolume = (part: BuildingPart): BuildingNavigationVolume => {
  if (!part.rotation?.[0] && !part.rotation?.[2]) return {
    min: part.position.map((value, axis) => value - part.size[axis]! / 2) as Point3,
    max: part.position.map((value, axis) => value + part.size[axis]! / 2) as Point3,
    shape: ["cylinder", "persian-room"].includes(part.shape) ? "ellipse" : "box",
    yaw: part.rotation?.[1]
  };
  return getRomanPartBounds(part);
};
const floorInterior = (part: BuildingPart) => part.stage === 0 && !part.stock &&
  ["mosaic", "planks", "stone", "cut-stone"].includes(part.surface) &&
  part.size[1] < .08 && part.size[0] > .4 && part.size[2] > .4;
const inferredInteriors = (recipe: BuildingRecipe) => {
  const membranes = recipe.parts.filter(part => (part.shape === "persian-room" ||
    part.shape === "indigenous-roof" && part.indigenousRoof !== "awning") &&
    part.position[1] - part.size[1] / 2 < .25 && part.size[1] > .3);
  if (!membranes.length) return recipe.parts.filter(floorInterior).map(partVolume);
  return membranes.flatMap(part => {
    const volume = partVolume(part);
    if (part.indigenousRoof === "tipi" || part.shape === "persian-room") return [{ ...volume, shape: "ellipse" as const }];
    if (part.indigenousRoof !== "earth") return [volume];
    // Ground-level longhouses use the same capsule plan as indigenousRoofHeight.
    const [x, y, z] = part.position, [width, height, depth] = part.size;
    const make = (centerZ: number, halfZ: number, shape: "box" | "ellipse"): BuildingNavigationVolume => ({
      min: [x - width / 2, y - height / 2, centerZ - halfZ],
      max: [x + width / 2, y + height / 2, centerZ + halfZ], shape, yaw: part.rotation?.[1]
    });
    // Capsule component centres must rotate with the authored shell too.
    if (part.rotation?.[1]) return [volume];
    return [make(z, depth * .2, "box"), make(z - depth * .2, depth * .3, "ellipse"),
      make(z + depth * .2, depth * .3, "ellipse")];
  });
};
const passableDecoration = (part: BuildingPart, includeYardDecorations = false) =>
  part.occupationSign || (part.yardDecoration !== undefined && !includeYardDecorations) ||
  part.wallMountedDecoration || ["leaf", "rope", "fish", "bamboo-leaves"].includes(part.surface) ||
  ["nursery-sapling", "cacao-leaves", "cacao-pods", "vine-foliage", "wheat-ear", "wheat-stalk", "indigenous-floor-hide"].includes(part.shape);
/** `includeYardDecorations`: physical ground cover must clear grounded ornaments that navigation may pass. */
export const buildingPartNavigationVolumes = (
  parts: readonly BuildingPart[], scale: number, includeYardDecorations = false
) => parts.filter(part =>
  !passableDecoration(part, includeYardDecorations) && !floorInterior(part) && part.shape !== "persian-room" &&
  !(part.shape === "indigenous-roof" && part.indigenousRoof !== "awning"))
  .map(partVolume).filter(volume => volume.max[1] * scale > .065 && volume.min[1] * scale < WORKER_HEIGHT)
  .map(volume => scaledVolume(volume, scale));

/** Canonical High geometry is the physical source for both render LODs, cached by national level. */
export const getBuildingNavigationProfile = (typeId: number, nation: WorkerNation, level: BuildingLevel = 1) => {
  const key = `${typeId}:${nation}:${level}`;
  let profile = profiles.get(key);
  if (profile) return profile;
  const definition = getBuildingDefinition(typeId), recipe = leveledBuildingRecipe(definition, nation, true, level);
  const { scale } = getRomanBuildingWorldSizing(definition);
  const metadata = recipe.navigation;
  const interiors = (metadata?.interiors ?? inferredInteriors(recipe)).map(volume => scaledVolume(volume, scale));
  // The well opening remains a hazard even when its lowered bucket and dark shaft floor are hidden.
  if (definition.style === "well") interiors.push({ min: [-.36 * scale, -1, -.36 * scale],
    max: [.36 * scale, 2, .36 * scale], shape: "ellipse" });
  profile = { recipe, scale, interiors, obstacles: [...buildingPartNavigationVolumes(recipe.parts.filter(part => !part.stock), scale),
    ...(metadata?.staticObstacles ?? []).map(volume => scaledVolume(volume, scale))] };
  profiles.set(key, profile);
  return profile;
};

/** Live counts use the renderer's canonical mixed-ware slot order and packed support transforms. */
export const buildingStockNavigationVolumes = (profile: BuildingNavigationProfile,
  input: Readonly<Record<string, number>>, output: Readonly<Record<string, number>>) =>
  buildingPartNavigationVolumes(getRomanWareStockInventoryParts(profile.recipe, profile.scale, input, output)
    .filter(part => part.stock), profile.scale);
