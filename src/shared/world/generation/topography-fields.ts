import { DMath } from "../../math/deterministic-math";
import { getVertexCount, type GridSize,readVertex, sampleBilinear } from "../grid-geometry";
import { DEFAULT_SUN } from "../lighting";
import { clamp01 } from "../noise";
import { PREVAILING_WIND_DIRECTION } from "../prevailing-wind";

export interface TopographyFields {
  /** Positive in hollows, negative on crests (-1..1). */
  curvature: Float32Array;
  /** Positive exposed, negative sheltered (-1..1). */
  exposure: Float32Array;
  /** Sun-facing aspect (0..1). */
  heatLoad: Float32Array;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * Pure per-vertex heat load, curvature and Winstral wind exposure. `include` limits the work to
 * the vertices it accepts (the others stay 0), e.g. dry land for render-only masks.
 */
export const createTopographyFields = (
  grid: GridSize,
  heights: Float32Array,
  include?: (index: number) => boolean
): TopographyFields => {
  const count = getVertexCount(grid), stride = grid.cellsX + 1;
  const curvature = new Float32Array(count), exposure = new Float32Array(count), heatLoad = new Float32Array(count);
  const windX = PREVAILING_WIND_DIRECTION.x, windZ = PREVAILING_WIND_DIRECTION.z;
  for (let index = 0; index < count; index += 1) {
    if (include && !include(index)) continue;
    const x = index % stride, z = Math.floor(index / stride);
    const height = heights[index]!;
    const dx = (readVertex(grid, heights, x + 1, z) - readVertex(grid, heights, x - 1, z)) / 2;
    const dz = (readVertex(grid, heights, x, z + 1) - readVertex(grid, heights, x, z - 1)) / 2;
    const length = Math.sqrt(1 + dx * dx + dz * dz);
    const nx = -dx / length, nz = -dz / length;
    heatLoad[index] = clamp01(.5 + .9 * (nx * DEFAULT_SUN.azimuthX + nz * DEFAULT_SUN.azimuthZ));
    const mean = (readVertex(grid, heights, x + 2, z) + readVertex(grid, heights, x - 2, z) +
      readVertex(grid, heights, x, z + 2) + readVertex(grid, heights, x, z - 2)) / 4;
    curvature[index] = clamp((mean - height) / .5, -1, 1);
    let slope = -Infinity;
    for (let step = 1; step <= 16; step += 1) {
      const sampleX = x - windX * step, sampleZ = z - windZ * step;
      if (sampleX < 0 || sampleZ < 0 || sampleX > grid.cellsX || sampleZ > grid.cellsZ) break;
      const up = sampleBilinear(grid, heights, sampleX, sampleZ);
      slope = Math.max(slope, DMath.atan((up - height) / step));
    }
    exposure[index] = Number.isFinite(slope) ? clamp(-slope / .5, -1, 1) : 0;
  }
  return { curvature, exposure, heatLoad };
};
