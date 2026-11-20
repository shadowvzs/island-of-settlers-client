import { getVertexCount, type GridSize } from "../grid-geometry";
import { readSplatWeights, shiftGreenToBuffer, writeSplatWeights } from "../ground-buffer";
import { smoothstep } from "../noise";
import { MATERIAL, MATERIAL_COUNT } from "../world-data";

/** Mine ground share from the vertex mine field: full a little inside the zone edge. */
const MINE_SHARE = { full: 0.7, start: 0.1 } as const;
/** Snow keeps this part of its weight on mine ground: a thin crust the gravel breaks through. */
const SNOW_KEPT = 0.55;
/** Pebble rim just outside the mine ground (green ground turns to gravel there). */
const RIM = { full: 0.3, start: 0.02, strength: 0.8 } as const;
const NO_SOIL = { dirt: 0, sand: 0, snow: 0 } as const;
/**
 * Coast distance (cells) where painted mine gravel is gone and where it is full: a deposit or band
 * running down a valley ends in the beach's sand and soil instead of a grey strip to the water
 * (owner 2026-11-13). Splat only: mine land, ore and plots keep their extent.
 */
export const MINE_GRAVEL_COAST = { far: 4.5, near: 2 } as const;

/**
 * Moves the vertex weights into mine ground by its share; snow keeps part of its weight, so a
 * snowy mine field stays partly white.
 */
export const shiftToMineGround = (weights: Float32Array, share: number) => {
  if (share <= 0) return;
  const keptSnow = weights[MATERIAL.snow]! * share * SNOW_KEPT;
  let total = 0;
  for (let material = 0; material < MATERIAL_COUNT; material += 1) {
    total += weights[material]!;
    weights[material] = weights[material]! * (1 - share);
  }
  weights[MATERIAL.snow] = weights[MATERIAL.snow]! + keptSnow;
  weights[MATERIAL.mine] = weights[MATERIAL.mine]! + total * share - keptSnow;
};

/**
 * Paints the mine zones into the splat: mine gravel inside, a pebble rim (gravel) on the green
 * ground just outside, so the field reads as a distinct stony area with a crisp edge; and the
 * mine gravel band touching the massif rock (`contact`), so rock borders only mine gravel; both fade
 * out towards the water (MINE_GRAVEL_COAST).
 */
export const applyMineGround = (
  grid: GridSize,
  splat: Uint8Array,
  layers: { coastDistance: Float32Array; contact: Float32Array; mineGround: Float32Array }
) => {
  const { coastDistance, contact, mineGround } = layers;
  const weights = new Float32Array(MATERIAL_COUNT);
  for (let vertex = 0; vertex < getVertexCount(grid); vertex += 1) {
    const coast = smoothstep(MINE_GRAVEL_COAST.near, MINE_GRAVEL_COAST.far, coastDistance[vertex]!);
    const ground = Math.max(mineGround[vertex]!, contact[vertex]!) * coast;
    if (ground <= RIM.start) continue;
    readSplatWeights(splat, vertex, weights);
    const share = smoothstep(MINE_SHARE.start, MINE_SHARE.full, ground);
    const rim = smoothstep(RIM.start, RIM.full, ground) * (1 - share) * RIM.strength;
    shiftGreenToBuffer(weights, rim, 0, NO_SOIL);
    shiftToMineGround(weights, share);
    writeSplatWeights(splat, vertex, weights);
  }
};

/**
 * Mine land (with the open band at the massif feet) is cleared like settlement clearings: no
 * trees, bushes or stones inside.
 */
export const addMineClearing = (clearing: Float32Array, mineLand: Float32Array) =>
  clearing.map((value, index) => Math.max(value, smoothstep(0.01, 0.08, mineLand[index]!)));
