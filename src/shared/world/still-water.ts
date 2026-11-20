import { DMath } from "../math/deterministic-math";
import { type CellRegion, getVertexCount, type GridSize } from "./grid-geometry";
import { smoothstep } from "./noise";
import type { Waterfall } from "./world-data";

/** Flow speed range (flow layer units: rivers run 0.6 .. 2.6, plunge pools 0.8) calm -> moving. */
const CALM_SPEED = [0.8, 1.05] as const;
/** River water this close to the sea level is the estuary: brackish, open to the sea. */
const FRESH_MARGIN = 0.25;
/** River beds and their banks (cells): the bank vertices keep the stillness up to the shore. */
const RIVER_REACH = 2;
/** Turbulence around the foot of a waterfall (cells): spray and churn, then calm. */
const FALL_CHURN = [1.2, 2.4] as const;

export interface StillWaterInputs {
  flow: Float32Array;
  /** Map editor lakes: fresh and still wherever they lie (no river needed). */
  lakeWater?: Uint8Array;
  riverDistance: Float32Array;
  seaLevel: number;
  waterSurface: Float32Array;
  waterfalls: readonly Waterfall[];
}

/** 0 at the foot of a waterfall, 1 once the pool has settled. */
const getFallCalm = (waterfalls: readonly Waterfall[], x: number, z: number) => {
  let calm = 1;
  for (const fall of waterfalls) {
    const distance = DMath.hypot(x - fall.x, z - fall.z);
    calm = Math.min(calm, smoothstep(FALL_CHURN[0], FALL_CHURN[1], distance));
  }
  return calm;
};

const isFreshRiverWater = (inputs: StillWaterInputs, index: number) =>
  (inputs.riverDistance[index]! <= RIVER_REACH || inputs.lakeWater?.[index] === 1) &&
  inputs.waterSurface[index]! >= inputs.seaLevel + FRESH_MARGIN;

/** Stillness of one vertex (see createStillWater). */
const getStillness = (inputs: StillWaterInputs, index: number, stride: number) => {
  if (!isFreshRiverWater(inputs, index)) return 0;
  const speed = DMath.hypot(inputs.flow[index * 2]!, inputs.flow[index * 2 + 1]!);
  const calm = 1 - smoothstep(CALM_SPEED[0], CALM_SPEED[1], speed);
  if (calm <= 0) return 0;
  return calm * getFallCalm(inputs.waterfalls, index % stride, Math.floor(index / stride));
};

/**
 * Stillness 0..1 per vertex of fresh calm water: slow river stretches and settled plunge pools
 * (their banks included, so the field holds up to the shoreline); 0 on the sea, in estuaries,
 * fast channels and below falls. Water plants (lilies, reed beds, duckweed, weeds) grow by it.
 */
export const createStillWater = (grid: GridSize, inputs: StillWaterInputs) => {
  const still = new Float32Array(getVertexCount(grid));
  const stride = grid.cellsX + 1;
  for (let index = 0; index < still.length; index += 1) {
    still[index] = getStillness(inputs, index, stride);
  }
  return still;
};

/** Measures the stillness of a region's vertices again (map editor lakes; per vertex). */
export const refreshStillWater = (
  still: Float32Array,
  grid: GridSize,
  inputs: StillWaterInputs,
  region: CellRegion
) => {
  const stride = grid.cellsX + 1;
  for (let vertexZ = region.minZ; vertexZ <= region.maxZ + 1; vertexZ += 1) {
    for (let vertexX = region.minX; vertexX <= region.maxX + 1; vertexX += 1) {
      const index = vertexZ * stride + vertexX;
      still[index] = getStillness(inputs, index, stride);
    }
  }
};

/** Bilinear query of the same generator stillness policy, without allocating a world-sized field. */
export const sampleStillWater = (grid: GridSize, inputs: StillWaterInputs, x: number, z: number) => {
  const cx = Math.max(0, Math.min(grid.cellsX - 1, Math.floor(x)));
  const cz = Math.max(0, Math.min(grid.cellsZ - 1, Math.floor(z)));
  const dx = Math.max(0, Math.min(1, x - cx)), dz = Math.max(0, Math.min(1, z - cz));
  const stride = grid.cellsX + 1, index = cz * stride + cx;
  const top = getStillness(inputs, index, stride) * (1 - dx) + getStillness(inputs, index + 1, stride) * dx;
  const bottom = getStillness(inputs, index + stride, stride) * (1 - dx) + getStillness(inputs, index + stride + 1, stride) * dx;
  return top * (1 - dz) + bottom * dz;
};
