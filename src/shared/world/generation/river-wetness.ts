import { getVertexCount, getVertexSlope, type GridSize } from "../grid-geometry";
import { smoothstep } from "../noise";
import type { Waterfall } from "../world-data";

/** Spray reach around a fall (cells): a base plus a share of its height and width. */
const SPRAY_BASE = 2;
const SPRAY_PER_HEIGHT = 1.2;
const SPRAY_PER_WIDTH = 0.5;
/** Splash along steep channels: this far from the bed (cells), on ground this steep. */
const SPLASH_REACH = 2.5;
const SPLASH_SLOPE_FROM = 0.45;
const SPLASH_SLOPE_TO = 0.9;
const SPLASH_STRENGTH = 0.6;

/** Spray wetness 0..1 of one fall at a vertex: around the lip, the sheet and the pool. */
const getSpray = (fall: Waterfall, vertexX: number, vertexZ: number) => {
  const reach =
    SPRAY_BASE + (fall.top - fall.bottom) * SPRAY_PER_HEIGHT + fall.width * SPRAY_PER_WIDTH;
  const distance = Math.min(
    Math.hypot(vertexX - fall.x, vertexZ - fall.z),
    Math.hypot(vertexX - fall.poolX, vertexZ - fall.poolZ) - fall.poolRadius * 0.5
  );
  return 1 - smoothstep(reach * 0.35, reach, distance);
};

/** Writes the spray of one fall (max with what is there). */
const addSpray = (grid: GridSize, wet: Float32Array, fall: Waterfall) => {
  const stride = grid.cellsX + 1;
  const reach = SPRAY_BASE + (fall.top - fall.bottom) * SPRAY_PER_HEIGHT + fall.width + 4;
  const centreX = (fall.x + fall.poolX) / 2;
  const centreZ = (fall.z + fall.poolZ) / 2;
  for (
    let vertexZ = Math.max(0, Math.ceil(centreZ - reach));
    vertexZ <= Math.min(grid.cellsZ, centreZ + reach);
    vertexZ += 1
  ) {
    for (
      let vertexX = Math.max(0, Math.ceil(centreX - reach));
      vertexX <= Math.min(grid.cellsX, centreX + reach);
      vertexX += 1
    ) {
      const index = vertexZ * stride + vertexX;
      wet[index] = Math.max(wet[index]!, getSpray(fall, vertexX, vertexZ));
    }
  }
};

/**
 * Wet rock and ground 0..255: spray around waterfalls and plunge pools, splash along channels
 * through steep ground (gorge walls).
 */
export const createWetRock = (
  grid: GridSize,
  heights: Float32Array,
  riverDistance: Float32Array,
  waterfalls: Waterfall[]
) => {
  const count = getVertexCount(grid);
  const wet = new Float32Array(count);
  const stride = grid.cellsX + 1;
  for (let index = 0; index < count; index += 1) {
    const distance = riverDistance[index]!;
    if (distance > SPLASH_REACH) continue;
    const slope = getVertexSlope(grid, heights, index % stride, Math.floor(index / stride));
    const steep = smoothstep(SPLASH_SLOPE_FROM, SPLASH_SLOPE_TO, slope);
    wet[index] = steep * (1 - distance / SPLASH_REACH) * SPLASH_STRENGTH;
  }
  for (const fall of waterfalls) addSpray(grid, wet, fall);
  return Uint8Array.from(wet, (value) => Math.round(value * 255));
};
