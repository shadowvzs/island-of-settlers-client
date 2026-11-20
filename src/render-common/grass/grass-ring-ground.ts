import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { createCoverTintSampler, getZoneCoverKeepAt } from "../props/field-cover";
import { roadsideCoverWeight } from "../props/field-cover-exclusions";
import { GRASS_RING_SAMPLE_SPACING, GRASS_RING_TILE, GRASS_RING_TINT_RANGE } from "./grass-ring-layout";

/**
 * Roadside value of the road corridor: below every verge weight (0..1), so the bilinear blend
 * between a corridor sample and its neighbour turns negative right at the corridor edge.
 */
export const GRASS_RING_ROAD_CORRIDOR = -0.5;

/** Packs a 0..GRASS_RING_TINT_RANGE colour into one exactly representable float (8 bits per channel). */
export const packGrassRingTint = (red: number, green: number, blue: number) => {
  const quantise = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value / GRASS_RING_TINT_RANGE)) * 255);
  return quantise(red) * 65536 + quantise(green) * 256 + quantise(blue);
};

/** Writes height, packed grass tint, roadside keep and zone cover keep of a world point at `offset` (4 floats). */
export type GrassRingGroundSampler = (x: number, z: number, target: Float32Array, offset: number) => void;

const SAMPLES_PER_TILE = GRASS_RING_TILE / GRASS_RING_SAMPLE_SPACING;
const STALE = -0x7fffffff;

/**
 * Toroidal window of ring ground samples (4 floats per texel): sample (i, j) lives at texel
 * (i mod size, j mod size), so a ring move only fills the samples that entered the window.
 */
export interface GrassRingGround {
  data: Float32Array;
  /** Sample index (x, z) currently stored per texel; STALE forces a refill. */
  keys: Int32Array;
  size: number;
}

export const createGrassRingGround = (size: number): GrassRingGround => {
  const keys = new Int32Array(size * size * 2);
  keys.fill(STALE);
  return { data: new Float32Array(size * size * 4), keys, size };
};

/** Map edits (terrain, splat): every sample is filled again on the next move check. */
export const invalidateGrassRingGround = (ground: GrassRingGround) => ground.keys.fill(STALE);

const wrap = (value: number, size: number) => ((value % size) + size) % size;

/**
 * Fills the samples of the window around `centreTile` (the tile reach on each side) that are not
 * stored yet. Returns the number of samples written (0: nothing to upload).
 */
export const fillGrassRingGround = (
  ground: GrassRingGround,
  sample: GrassRingGroundSampler,
  centreTileX: number,
  centreTileZ: number,
  tileReach: number
) => {
  const startX = (centreTileX - tileReach) * SAMPLES_PER_TILE;
  const startZ = (centreTileZ - tileReach) * SAMPLES_PER_TILE;
  let written = 0;
  for (let indexZ = startZ; indexZ < startZ + ground.size; indexZ++) {
    const row = wrap(indexZ, ground.size) * ground.size;
    for (let indexX = startX; indexX < startX + ground.size; indexX++) {
      const texel = row + wrap(indexX, ground.size);
      if (ground.keys[texel * 2] === indexX && ground.keys[texel * 2 + 1] === indexZ) continue;
      ground.keys[texel * 2] = indexX;
      ground.keys[texel * 2 + 1] = indexZ;
      sample(indexX * GRASS_RING_SAMPLE_SPACING, indexZ * GRASS_RING_SAMPLE_SPACING, ground.data, texel * 4);
      written++;
    }
  }
  return written;
};

/**
 * Terrain height (the terrain mesh's own vertex sampling), the field-cover grass tint, the
 * point-accurate roadside weight the tufts use (the corridor value on the road, the verge falloff):
 * the cell-sized cover field alone would let blades onto the edge of a paved road, and the alpine
 * and lichen zones' cover keep (the tufts' thinning there).
 */
export const createGrassRingGroundSampler = (world: WorldData): GrassRingGroundSampler => {
  const tint = createCoverTintSampler(world);
  return (x, z, target, offset) => {
    const clampedX = Math.min(world.cellsX - 1e-3, Math.max(0, x));
    const clampedZ = Math.min(world.cellsZ - 1e-3, Math.max(0, z));
    const [red, green, blue] = tint(clampedX, clampedZ);
    target[offset] = sampleSmooth(world, world.heights, x, z);
    target[offset + 1] = packGrassRingTint(red, green, blue);
    target[offset + 2] = roadsideCoverWeight(world, clampedX, clampedZ) ?? GRASS_RING_ROAD_CORRIDOR;
    target[offset + 3] = getZoneCoverKeepAt(world, clampedX, clampedZ);
  };
};
