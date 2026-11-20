import { getWaterlineFoot,LILY_DEPTH, LILY_FLOAT, LILY_STILLNESS, REED_BED_DEPTH, REED_BED_STILLNESS } from "../generation/water-plants";
import { sampleBilinear, sampleSmooth } from "../grid-geometry";
import { sampleStillWater } from "../still-water";
import { PROP, type WorldData } from "../world-data";
import type { EditRefusal } from "./edit-refusal";

export const isAquaticDecoration = (kind: number) =>
  kind === PROP.waterLily || kind === PROP.reeds || kind === PROP.cattail;

/** Reuse the generator's fresh-water, flow, waterfall and depth policies; no ocean lilies. */
export const aquaticDecorationSpot = (world: WorldData, kind: number, x: number, z: number):
  { y: number; refusal: null } | { refusal: EditRefusal } | null => {
  if (!isAquaticDecoration(kind)) return null;
  const ground = sampleSmooth(world, world.heights, x, z);
  const surface = sampleBilinear(world, world.waterSurface, x, z);
  const depth = surface - ground;
  // Existing bank reeds/cattails keep their ordinary dry-ground placement.
  if (kind !== PROP.waterLily && depth <= 0) return null;
  const still = sampleStillWater(world, world, x, z);
  if (kind === PROP.waterLily) {
    if (depth < LILY_DEPTH[0] || depth > LILY_DEPTH[1] || still < LILY_STILLNESS) return { refusal: "water" };
    return { y: surface + LILY_FLOAT, refusal: null };
  }
  if (depth > REED_BED_DEPTH || still < REED_BED_STILLNESS || ground > 3.5) return { refusal: "water" };
  return { y: getWaterlineFoot(ground, surface), refusal: null };
};
