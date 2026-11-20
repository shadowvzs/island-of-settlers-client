import { describe, expect, it } from "vitest";

import {
  buildSurfaceMask,
  getDryness,
  getNearbyRapids,
  getRiverWetness,
  getSurfaceMask,
  getTalus,
  SURFACE_CHANNEL,
  SURFACE_CHANNELS,
  type SurfaceMaskSource
} from "../src/render-common/surface-mask";
import { buildChunk } from "../src/render-common/terrain-chunks";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { cachedWorld } from "./helpers/cached-worlds";

const SIZE = 24;
const STRIDE = SIZE + 1;
const COUNT = STRIDE * STRIDE;

/**
 * A 24² test grid: sea along z = 0..2, a river channel along x = 12 (fast at z 14..16), a cliff
 * rising 4 units at x = 4 on the west, gentle land elsewhere.
 */
const createSource = (): SurfaceMaskSource => {
  const heights = new Float32Array(COUNT), waterDepth = new Float32Array(COUNT);
  const riverDistance = new Float32Array(COUNT), flow = new Float32Array(COUNT * 2);
  const moisture = new Uint8Array(COUNT).fill(100), wetRock = new Uint8Array(COUNT);
  for (let z = 0; z <= SIZE; z += 1) {
    for (let x = 0; x <= SIZE; x += 1) {
      const index = z * STRIDE + x;
      heights[index] = (z <= 2 ? -1 : (z - 2) * 0.1) + (x < 4 ? 4 : 0);
      riverDistance[index] = Math.abs(x - 12);
      if (z <= 2) waterDepth[index] = 1;
      if (x === 12 && z > 2) {
        waterDepth[index] = 0.4;
        flow[index * 2 + 1] = z >= 14 && z <= 16 ? 2.4 : 0.6;
      }
    }
  }
  return { cellsX: SIZE, cellsZ: SIZE, flow, heights, moisture, riverDistance, seaLevel: 0, waterDepth, wetRock };
};

const read = (mask: Uint8Array, x: number, z: number, channel: number) =>
  mask[(z * STRIDE + x) * SURFACE_CHANNELS + channel]! / 255;

describe("surface mask builders (TT-2)", () => {
  it("wets river banks, wider and wetter beside rapids, and the spray of falls", () => {
    expect(getRiverWetness(0.5, 0, 0)).toBeCloseTo(0.42);
    expect(getRiverWetness(1.5, 0, 0)).toBeGreaterThan(0);
    expect(getRiverWetness(2, 0, 0)).toBe(0);
    expect(getRiverWetness(2, 0, 1)).toBeGreaterThan(0);
    expect(getRiverWetness(0.5, 0, 1)).toBeCloseTo(0.6);
    expect(getRiverWetness(9, 1, 0)).toBeCloseTo(0.65);
  });

  it("puts talus near cliffs on moderate concave slopes only", () => {
    expect(getTalus(1, 0.3, 0.3)).toBeCloseTo(1);
    expect(getTalus(4, 0.3, 0.3)).toBe(0);
    expect(getTalus(1, 0, 0.3)).toBe(0);
    expect(getTalus(1, 1.2, 0.3)).toBe(0);
    expect(getTalus(1, 0.3, -0.3)).toBe(0);
  });

  it("dries sun-facing exposed ground with low moisture", () => {
    expect(getDryness(1, 1, 0)).toBe(1);
    expect(getDryness(1, 1, 1)).toBe(0);
    expect(getDryness(1, -1, 0)).toBe(0);
    expect(getDryness(0.5, 0, 0.5)).toBeCloseTo(0.125);
  });

  it("finds rapids in the vertex neighbourhood", () => {
    const source = createSource();
    expect(getNearbyRapids(source, source.flow, 11, 15)).toBe(1);
    expect(getNearbyRapids(source, source.flow, 11, 8)).toBe(0);
    expect(getNearbyRapids(source, source.flow, 9, 15)).toBe(0);
  });

  it("builds the four channels of a grid", () => {
    const mask = buildSurfaceMask(createSource());
    expect(mask.length).toBe(COUNT * SURFACE_CHANNELS);
    const { coast, dry, talus, wetness } = SURFACE_CHANNEL;
    expect(read(mask, 11, 8, wetness)).toBeGreaterThan(0.3);
    expect(read(mask, 13, 15, wetness)).toBeGreaterThan(read(mask, 13, 8, wetness));
    expect(read(mask, 18, 8, wetness)).toBe(0);
    expect(read(mask, 3, 2, coast)).toBeGreaterThan(read(mask, 18, 2, coast));
    expect(read(mask, 18, 1, dry)).toBe(0);
    expect(read(mask, 18, 1, talus)).toBe(0);
    expect(read(mask, 18, 12, dry)).toBeGreaterThan(0);
    expect(read(mask, 20, 12, talus)).toBe(0);
  });
});

describe("surface mask on terrain chunks", () => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, erosionDroplets: 8000 });
  const fog = new Float32Array(97 * 97).fill(1);

  it("fills the terrain surface and leaves the water surface empty", () => {
    const terrain = buildChunk(world, fog, 1, 1, "terrain")!;
    expect(terrain.surface.length).toBe(terrain.vertexCount * SURFACE_CHANNELS);
    expect(terrain.surface.some(value => value > 0)).toBe(true);
    const water = buildChunk(world, fog, 1, 1, "water");
    expect(water?.surface.every(value => value === 0) ?? true).toBe(true);
  });

  it("is cached per world and rebuilt after a terrain edit, but not for the editor preview", () => {
    const first = getSurfaceMask(world);
    expect(getSurfaceMask(world)).toBe(first);
    world.terrainRevision = (world.terrainRevision ?? 0) + 1;
    expect(getSurfaceMask(world, true)).toBe(first);
    expect(getSurfaceMask(world)).not.toBe(first);
  });
});
