import { describe, expect, it } from "vitest";

import { createVertexFog } from "../src/render-common/chunk-sampling";
import { buildChunk, CHUNK_CELLS, type ChunkVertexData } from "../src/render-common/terrain-chunks";
import { WATER_STEP_RISE } from "../src/render-common/water/water-steps";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import type { Waterfall, WorldData } from "../src/shared/world/world-data";
import { cachedWorldBeforeAll } from "./helpers/cached-worlds";

const REACH = 4;

interface Triangle {
  heights: number[];
  /** Every corner mixes only pool levels (no sea level filler of dry land: shoreline ramps). */
  isPool: boolean;
  x: number;
  z: number;
}

/** Same rule as water-steps.ts: dry land carries the sea level as a filler water surface. */
const isPoolPoint = (world: WorldData, x: number, z: number) => {
  const stride = world.cellsX + 1;
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const xs = x > x0 ? [x0, x0 + 1] : [x0], zs = z > z0 ? [z0, z0 + 1] : [z0];
  return xs.every(cellX => zs.every(cellZ => {
    const index = cellZ * stride + cellX;
    return world.waterSurface[index]! > world.seaLevel + 1e-6 || world.heights[index]! <= world.seaLevel;
  }));
};

const listTriangles = (world: WorldData, data: ChunkVertexData): Triangle[] => {
  const triangles: Triangle[] = [];
  for (let offset = 0; offset < data.indices.length; offset += 3) {
    const corners = [0, 1, 2].map(corner => data.indices[offset + corner]!);
    triangles.push({
      heights: corners.map(corner => data.positions[corner * 3 + 1]!),
      isPool: corners.every(corner => isPoolPoint(world, data.positions[corner * 3]!, data.positions[corner * 3 + 2]!)),
      x: corners.reduce((sum, corner) => sum + data.positions[corner * 3]!, 0) / 3,
      z: corners.reduce((sum, corner) => sum + data.positions[corner * 3 + 2]!, 0) / 3
    });
  }
  return triangles;
};

const isNear = (triangle: Triangle, fall: Waterfall) =>
  Math.hypot(triangle.x - fall.x, triangle.z - fall.z) <= fall.width / 2 + REACH;

const getRise = ({ heights }: Triangle) => Math.max(...heights) - Math.min(...heights);

/** A slab spans two pools: its corner levels part by more than WATER_STEP_RISE (rapids slope gently). */
const isSlab = ({ heights }: Triangle) => {
  const sorted = [...heights].sort((a, b) => a - b);
  return sorted.some((height, index) => index > 0 && height - sorted[index - 1]! > WATER_STEP_RISE);
};

const waterChunkOf = (world: WorldData, fall: Waterfall) => {
  const chunkX = Math.floor(fall.x / CHUNK_CELLS), chunkZ = Math.floor(fall.z / CHUNK_CELLS);
  return buildChunk(world, createVertexFog(world), chunkX, chunkZ, "water")!;
};

describe("water surface at waterfalls (RC-0, TT-6)", () => {
  const getIsland = cachedWorldBeforeAll({ ...DEFAULT_WORLD_OPTIONS, landform: "island", seed: 7 });

  it("splits every fall into a flat upper and a flat lower pool (no slanted slab)", () => {
    const world = getIsland();
    expect(world.waterfalls.length).toBeGreaterThan(0);
    for (const fall of world.waterfalls) {
      const near = listTriangles(world, waterChunkOf(world, fall)).filter(triangle => isNear(triangle, fall));
      const water = near.filter(triangle => triangle.isPool);
      expect(water.filter(isSlab)).toEqual([]);
      const isFlatAt = (level: number) => (triangle: Triangle) =>
        triangle.heights.every(height => Math.abs(height - level) <= WATER_STEP_RISE);
      expect(water.some(isFlatAt(fall.top))).toBe(true);
      /** The lower pool: at the foot's level, or lower where the estuary sinks it to the sea. */
      expect(water.some(triangle => getRise(triangle) < 0.05 && triangle.heights[0]! < fall.bottom + 0.05))
        .toBe(true);
    }
  });

  it("appends the fall line vertices after the grid vertices", () => {
    const world = getIsland();
    const chunk = waterChunkOf(world, world.waterfalls[0]!);
    const gridVertices = (chunk.columns! + 1) ** 2;
    expect(chunk.vertexCount).toBeGreaterThan(gridVertices);
    expect(chunk.positions.length).toBe(chunk.vertexCount * 3);
    expect(chunk.water.length).toBe(chunk.vertexCount * 4);
    expect(Math.max(...chunk.indices)).toBeLessThan(chunk.vertexCount);
  });
});
