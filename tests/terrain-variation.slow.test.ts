import { describe, expect, it } from "vitest";

import { ROAD_PLACEMENT_WIDTH } from "../src/shared/settlement/road-types";
import { ISLAND_SPACE } from "../src/shared/world/generation/archipelago-rules";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { BUILD } from "../src/shared/world/world-data";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

const cases = [
  [64, 64, 7, 0, 0, 1], [64, 64, 7, 2, 0, 1],
  ...[7, 42].flatMap(seed => [0, 1, 2].map(amount => [128, 128, seed, amount, 0, 1])),
  [256, 256, 1234, 0, 0, 2], [256, 256, 1234, 2, 0, 2],
  [128, 192, 42, 1, 0, 1], [128, 128, 7, 1, .01, 1], [128, 128, 7, 2, .01, 1]
].map(([cellsX, cellsZ, seed, terrainVariation, rivers, islandCount]) => ({
  ...DEFAULT_WORLD_OPTIONS, cellsX: cellsX!, cellsZ: cellsZ!, seed: seed!, terrainVariation: terrainVariation!,
  rivers: rivers!, islandCount: islandCount!, landform: "archipelago" as const, erosionDroplets: 200
}));
preloadWorlds(...cases);
const peak = (heights: Float32Array) => heights.reduce((highest, height) => Math.max(highest, height), -Infinity);

describe("generated relief with current building and road contracts", () => {
  it.each(cases)("keeps requested islands, foundations and actual harbour road buildable: $cellsX×$cellsZ/$seed/$terrainVariation/$rivers",
    options => {
      // Generation itself validates native HQ/harbour placement plus a real road construction plan
      // while all four future plots, HQ and candidate harbour foundations are reserved.
      const world = cachedWorld(options);
      expect(world.playableIslands?.sites).toHaveLength(options.islandCount);
      expect(ISLAND_SPACE.roadWidth).toBeGreaterThanOrEqual(ROAD_PLACEMENT_WIDTH);
      for (const site of world.playableIslands!.sites) {
        expect(site.buildingCount).toBe(4);
        expect(site.harbour).toBeDefined();
        for (let z = site.z - site.spaceDepth / 2; z < site.z + site.spaceDepth / 2; z++)
          for (let x = site.x - site.spaceWidth / 2; x < site.x + site.spaceWidth / 2; x++) {
            const cell = z * world.cellsX + x;
            expect(world.blocking[cell]).toBe(0);
            expect(world.slopeClass[cell]).toBe(0);
            expect(world.buildCap[cell]).toBe(BUILD.large);
          }
      }
      expect(world.heights.every(Number.isFinite)).toBe(true);
      expect(world.generationProvenance?.options.terrainVariation).toBe(options.terrainVariation);
      if (options.terrainVariation === 0) expect(peak(world.heights)).toBeLessThanOrEqual(2.01);
    });

  it.each([7, 42])("adds seed-dependent relief on dry islands while retaining the flat option: %i", seed => {
    const worlds = [0, 1, 2].map(amount => cachedWorld(cases.find(options =>
      options.cellsX === 128 && options.cellsZ === 128 && options.seed === seed &&
      options.rivers === 0 && options.terrainVariation === amount)!));
    expect(peak(worlds[1]!.heights)).toBeGreaterThan(peak(worlds[0]!.heights) + 1);
    expect(peak(worlds[2]!.heights)).toBeGreaterThan(peak(worlds[1]!.heights) + 1);
    expect(worlds[1]!.heights).not.toEqual(worlds[0]!.heights);
  });
});
