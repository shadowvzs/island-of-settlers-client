import { DMath } from "../../../math/deterministic-math";
import { sampleBilinear, sampleSmooth } from "../../grid-geometry";
import { smoothstep } from "../../noise";
import { createRandom } from "../../rng";
import { MATERIAL, MATERIAL_COUNT, PROP, type WorldData } from "../../world-data";
import { getFootprintRatio, getStampBounds, getStampRise, type TerrainStamp } from "./terrain-stamps";

/** Source-profile shelves retain living soil; steep/high faces and the external talus stay rock. */
export const getMountainShelfShare = (
  stamps: readonly TerrainStamp[], x: number, z: number, height: number, slope: number
) => {
  if (slope >= 0.5 || height >= 6) return 0;
  if (!stamps.some(stamp => stamp.template && getFootprintRatio(stamp, x, z) < 0.9)) return 0;
  return (1 - smoothstep(0.18, 0.5, slope)) * (1 - smoothstep(4.6, 6, height));
};

const sampleSlope = (world: WorldData, x: number, z: number) => {
  const height = (dx: number, dz: number) => sampleSmooth(world, world.heights, x + dx, z + dz);
  return DMath.hypot((height(0.25, 0) - height(-0.25, 0)) * 2,
    (height(0, 0.25) - height(0, -0.25)) * 2);
};

/** A conservative root neighbourhood excludes narrow shelves beside displaced rock faces. */
const isRootableShelf = (world: WorldData, stamp: TerrainStamp, x: number, z: number) => {
  if (x < 1 || z < 1 || x >= world.cellsX - 1 || z >= world.cellsZ - 1) return false;
  if (getFootprintRatio(stamp, x, z) >= 0.95 || getStampRise(stamp, x, z) <= 0.25) return false;
  const height = sampleSmooth(world, world.heights, x, z);
  if (height > 5.2 || sampleBilinear(world, world.waterDepth, x, z) > 0) return false;
  if (sampleBilinear(world, world.coastDistance, x, z) < 2) return false;
  const vertex = Math.round(z) * (world.cellsX + 1) + Math.round(x);
  const shares = [MATERIAL.mine, MATERIAL.rock, MATERIAL.snow].map(material =>
    world.splat[vertex * MATERIAL_COUNT + material]! / 255);
  if (Math.max(...shares) > 0.35) return false;
  for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) {
    if (sampleSlope(world, x + dx * 0.9, z + dz * 0.9) > 0.35) return false;
  }
  for (let index = 0; index < world.props.count; index += 1) {
    const type = world.props.types[index];
    if (type !== PROP.coniferTree && type !== PROP.broadleafTree && type !== PROP.birchTree &&
      type !== PROP.palmTree && type !== PROP.cedarTree && type !== PROP.walnutTree && type !== PROP.mahoganyTree && type !== PROP.hardwoodTree) continue;
    if (DMath.hypot(world.props.x[index]! - x, world.props.z[index]! - z) < 1.6) return false;
  }
  return true;
};

/** Bounded vegetation owned by the stamp; lowering/reset/history removes it with that stamp. */
export const planMountainVegetation = (world: WorldData, stamp: TerrainStamp) => {
  if (!stamp.template || stamp.level < 3 || stamp.kind === "lake") return [];
  const random = createRandom(stamp.seed + 413);
  const bounds = getStampBounds(stamp);
  const plants: { type: number; scale: number; x: number; y: number; z: number }[] = [];
  let trees = 0;
  for (let z = Math.max(1, Math.floor(bounds.minZ)); z < Math.min(world.cellsZ - 1, bounds.maxZ); z += 2) {
    for (let x = Math.max(1, Math.floor(bounds.minX)); x < Math.min(world.cellsX - 1, bounds.maxX); x += 2) {
      const px = x + 0.35 + random() * 0.6;
      const pz = z + 0.35 + random() * 0.6;
      const roll = random();
      if (roll > 0.55 || !isRootableShelf(world, stamp, px, pz)) continue;
      const tree = roll < 0.12 && trees < 8;
      if (tree) trees += 1;
      plants.push({
        type: tree ? PROP.coniferTree : PROP.fieldShrub,
        scale: tree ? 0.85 + random() * 0.2 : 0.65 + random() * 0.25,
        x: px, y: sampleSmooth(world, world.heights, px, pz), z: pz
      });
      if (plants.length >= 32) return plants;
    }
  }
  return plants;
};
