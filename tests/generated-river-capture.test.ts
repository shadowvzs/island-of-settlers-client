import { describe, expect, it } from "vitest";

import type { GeneratedRiver } from "../src/shared/world/editing/generated-river-types";
import { computeDistanceField } from "../src/shared/world/generation/distance-field";
import { applyGeneratedRiver } from "../src/shared/world/generation/generated-river-apply";
import { createGeneratedRiverCapture } from "../src/shared/world/generation/generated-river-capture";
import { carveRivers, type RiverLayers } from "../src/shared/world/generation/river-carving";
import { createWaterLayers } from "../src/shared/world/generation/water";
import type { WorldData } from "../src/shared/world/world-data";

const grid = { cellsX: 48, cellsZ: 48 };
const course = { mouthStep: 36, points: Array.from({ length: 41 }, (_, i) => ({ x: 24, z: i + 4 })) };
const widthAt = (_x: number, z: number) => 1 + z * .01;
const terrain = () => Float32Array.from({ length: 49 * 49 }, (_, vertex) => 6 - Math.floor(vertex / 49) * .15);
const worldFrom = (heights: Float32Array, layers: RiverLayers) => ({
  ...grid, heights, seaLevel: 0, ...createWaterLayers(grid, heights, layers.surface, 0),
  flow: layers.flow, waterfalls: layers.waterfalls,
  riverDistance: computeDistanceField(grid, vertex => layers.mask[vertex] === 1)
}) as WorldData;
const captureWorld = () => {
  const heights = terrain(), capture = createGeneratedRiverCapture(grid, heights, 0, widthAt);
  const layers = carveRivers(grid, heights, [course], 0, widthAt, capture);
  return { capture, world: worldFrom(heights, layers) };
};
const restoreOwned = (world: WorldData, river: GeneratedRiver) => {
  for (const patch of river.patches) {
    const [height, surface, depth, flowX, flowZ] = patch.before;
    world.heights[patch.vertex] = height!; world.waterSurface[patch.vertex] = surface!;
    world.waterDepth[patch.vertex] = depth!;
    world.flow[patch.vertex * 2] = flowX!; world.flow[patch.vertex * 2 + 1] = flowZ!;
  }
  world.waterfalls = [];
};

describe("generated river native provenance", () => {
  it("records variable native widths and profiles without changing any generated geometry or water", () => {
    const plainHeights = terrain();
    const plain = worldFrom(plainHeights, carveRivers(grid, plainHeights, [course], 0, widthAt));
    const { capture, world } = captureWorld(), before = structuredClone(world);
    const records = capture.finish(world);
    for (const key of ["heights", "waterSurface", "waterDepth", "flow", "riverDistance", "waterfalls"] as const)
      expect(world[key]).toEqual(plain[key]);
    expect(world).toEqual(before);
    expect(records).toHaveLength(1);
    expect(records[0]?.points).toEqual(course.points);
    expect(records[0]?.widthSamples[0]).not.toBe(records[0]?.widthSamples.at(-1));
    expect(records[0]?.profile).toHaveLength(course.points.length);
    expect(records[0]?.patches.length).toBeGreaterThan(0);
  });

  it("retains ordered before/after ownership where captured channels overlap", () => {
    const heights = terrain(), capture = createGeneratedRiverCapture(grid, heights, 0, widthAt);
    const crossing = { mouthStep: 36,
      points: Array.from({ length: 41 }, (_, i) => ({ x: i + 4, z: 24 })) };
    const layers = carveRivers(grid, heights, [course, crossing], 0, widthAt, capture);
    const world = worldFrom(heights, layers), records = capture.finish(world);
    const first = new Map(records[0]!.patches.map(patch => [patch.vertex, patch]));
    const overlaps = records[1]!.patches.filter(patch => {
      const earlier = first.get(patch.vertex);
      return earlier && earlier.before[0] !== earlier.after[0] && patch.before[0] !== patch.after[0];
    });
    expect(overlaps.length).toBeGreaterThan(0);
    for (const patch of overlaps) expect(first.get(patch.vertex)!.after[0]).toBe(patch.before[0]);
  });

  it("never claims pre-coast terrain ownership after a later independent height change", () => {
    const { capture, world } = captureWorld(), original = terrain();
    const vertex = world.heights.findIndex((height, i) => height !== original[i] && world.waterDepth[i]! > 0);
    expect(vertex).toBeGreaterThanOrEqual(0);
    const laterHeight = world.heights[vertex]! + 3;
    world.heights[vertex] = laterHeight;
    world.waterDepth[vertex] = Math.max(0, world.waterSurface[vertex]! - laterHeight);
    const record = capture.finish(world)[0]!;
    const patch = record.patches.find(item => item.vertex === vertex)!;
    expect(patch.before[0]).toBe(world.heights[vertex]);
    expect(patch.after[0]).toBe(world.heights[vertex]);
    restoreOwned(world, record);
    expect(world.heights[vertex]).toBe(Math.fround(laterHeight));
    expect(world.waterDepth[vertex]).toBeCloseTo(Math.max(0, world.waterSurface[vertex]! - world.heights[vertex]!));
  });

  it("reuses exact samples at unchanged scales and leaves terrain outside the owned channel untouched", () => {
    const { capture, world } = captureWorld(), record = capture.finish(world)[0]!;
    const expected = structuredClone(world);
    restoreOwned(world, record);
    const replayed = applyGeneratedRiver(world, record);
    expect(replayed.points).toEqual(record.points);
    for (const key of ["heights", "waterSurface", "waterDepth", "flow", "waterfalls"] as const)
      expect(world[key]).toEqual(expected[key]);
    const unowned = world.heights.findIndex((_height, i) => !record.patches.some(patch => patch.vertex === i));
    expect(world.heights[unowned]).toBe(expected.heights[unowned]);
  });
});
