import { DMath } from "../shared/math/deterministic-math";
import { getVertexCount, readVertex, sampleBilinear } from "../shared/world/grid-geometry";
import { DEFAULT_SUN } from "../shared/world/lighting";
import { clamp01, smoothstep } from "../shared/world/noise";
import { PREVAILING_WIND_DIRECTION } from "../shared/world/prevailing-wind";
import { MATERIAL, MATERIAL_COUNT, type WorldData } from "../shared/world/world-data";

const SNOW_WIND_STEPS = 12;

type SnowKeepWorld = Pick<
  WorldData,
  "ambientOcclusion" | "cellsX" | "cellsZ" | "coastDistance" | "heights" | "riverDistance" | "splat"
>;

/**
 * Per-vertex snow keep (0 bare .. 1 full snow) from slope, sun, wind, hollows, canopy and water.
 * Presentation only: it never writes back to the world, the simulation or a save.
 */
export const computeSnowKeep = (world: SnowKeepWorld): Float32Array => {
  const count = getVertexCount(world);
  const stride = world.cellsX + 1;
  const keep = new Float32Array(count);
  const windX = PREVAILING_WIND_DIRECTION.x;
  const windZ = PREVAILING_WIND_DIRECTION.z;
  for (let index = 0; index < count; index += 1) {
    // Owner rule: banks stay white to the waterline.
    if (world.coastDistance[index]! < 3 || world.riverDistance[index]! < 3) {
      keep[index] = 1;
      continue;
    }
    const x = index % stride;
    const z = Math.floor(index / stride);
    const height = world.heights[index]!;
    const dx = (readVertex(world, world.heights, x + 1, z) -
      readVertex(world, world.heights, x - 1, z)) / 2;
    const dz = (readVertex(world, world.heights, x, z + 1) -
      readVertex(world, world.heights, x, z - 1)) / 2;
    const slope = Math.sqrt(dx * dx + dz * dz);
    const stability = 1 - smoothstep(0.45, 1.2, slope);
    const length = Math.sqrt(1 + dx * dx + dz * dz);
    const nx = -dx / length;
    const nz = -dz / length;
    const sunFacing = nx * DEFAULT_SUN.azimuthX + nz * DEFAULT_SUN.azimuthZ;
    const melt = smoothstep(0.1, 0.5, sunFacing) * 0.5;
    let exposure = -Infinity;
    for (let step = 1; step <= SNOW_WIND_STEPS; step += 1) {
      const sampleX = x - windX * step;
      const sampleZ = z - windZ * step;
      if (sampleX < 0 || sampleZ < 0 || sampleX > world.cellsX || sampleZ > world.cellsZ) break;
      const up = sampleBilinear(world, world.heights, sampleX, sampleZ);
      exposure = Math.max(exposure, DMath.atan((up - height) / step));
    }
    const sx = Number.isFinite(exposure) ? exposure : 0;
    const drift = smoothstep(0, 0.3, sx) * 0.25;
    const scour = smoothstep(0, 0.3, -sx) * 0.35;
    const hollow = (1 - world.ambientOcclusion[index]! / 255) * 0.2;
    const canopy = world.splat[index * MATERIAL_COUNT + MATERIAL.forestFloor]! / 255 * 0.35;
    keep[index] = clamp01(stability * (1 - melt) - scour + drift + hollow - canopy + 0.1);
  }
  return keep;
};
