import { describe, expect, it } from "vitest";

import { ISLAND_SPACE, maxPlayableIslandCount, planPlayableIslands } from "../src/shared/world/generation/archipelago-rules";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { writeMapFile } from "../src/shared/world/save/map-writer";
import { BUILD, PROP } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

const create = (size: number, seed: number, similar = false, mountains = 1) => cachedWorld({
  ...DEFAULT_WORLD_OPTIONS, cellsX: size, cellsZ: size, seed, landform: "archipelago", similarIslandSizes: similar,
  erosionDroplets: 200, mountains, rivers: 0
});
describe("playable archipelago generation", () => {
  it("grows equal islands into available space while preserving ship channels", () => {
    const three = planPlayableIslands({ cellsX: 512, cellsZ: 512 }, 1234, true, 3);
    const eight = planPlayableIslands({ cellsX: 512, cellsZ: 512 }, 1234, true, 8);
    expect(three[0]!.radius).toBe(116);
    expect(three[0]!.radius).toBeGreaterThan(eight[0]!.radius);
    expect(new Set(three.map(site => site.radius)).size).toBe(1);
    for (const site of three) {
      expect(site.x - site.radius).toBeGreaterThanOrEqual(10);
      expect(site.z - site.radius).toBeGreaterThanOrEqual(10);
      expect(site.x + site.radius).toBeLessThanOrEqual(502);
      expect(site.z + site.radius).toBeLessThanOrEqual(502);
      for (const other of three) if (site !== other)
        expect(Math.hypot(site.x - other.x, site.z - other.z) - site.radius - other.radius).toBeGreaterThanOrEqual(25);
    }
  });
  it.each([[192, 7], [192, 42], [256, 2024], [512, 1234]])("reserves connected buildable plots and a real harbour on %i maps", (size, seed) => {
    const world = create(size!, seed!);
    const layout = world.playableIslands!;
    expect(layout.sites.length).toBeGreaterThanOrEqual(2);
    expect(layout.minimumBuildingArea).toEqual({ width: 20, depth: 20 });
    expect(layout.channelWidth).toBe(25);
    for (const site of layout.sites) {
      // The whole plot/road rectangle is usable, rather than counting scattered total land.
      for (let z = site.z - 10; z < site.z + 10; z++) for (let x = site.x - 10; x < site.x + 10; x++) {
        const cell = z * size! + x;
        expect(world.blocking[cell]).toBe(0);
        expect(world.buildCap[cell]).toBe(BUILD.large);
        expect(world.walkCost[cell]).toBeGreaterThan(0);
      }
      expect(site.harbour).toBeDefined(); // Generated only after actual placement/sea-route validation.
      for (const other of layout.sites) if (site !== other)
        expect(Math.hypot(other.x - site.x, other.z - site.z) - site.radius - other.radius).toBeGreaterThanOrEqual(25);
    }
  }, 60000);
  it("keeps the same four-plot minimum in similar-size mode", () => {
    const world = create(192, 1234, true);
    expect(world.playableIslands!.minimumBuildingArea).toEqual({ width: 20, depth: 20 });
    for (const site of world.playableIslands!.sites) {
      expect(site.buildingCount).toBe(4);
      expect(site.headquarters.z).toBeLessThan(site.z - site.spaceDepth / 2);
      expect(site.harbour.z).toBeGreaterThan(site.z + site.spaceDepth / 2);
    }
  });
  it("honours exact island counts without shrinking either building-space minimum", () => {
    for (const similar of [false, true]) for (const count of [2, 3, 5, 8]) {
      const sites = planPlayableIslands({ cellsX: 512, cellsZ: 512 }, 1234, similar, count);
      expect(sites).toHaveLength(count);
      for (const site of sites) {
        expect(site.buildingCount).toBe(4);
        expect(site.spaceWidth).toBeGreaterThanOrEqual(20);
        expect(site.spaceDepth).toBeGreaterThanOrEqual(20);
      }
    }
    expect(() => planPlayableIslands({ cellsX: 128, cellsZ: 128 }, 7, false, 8)).toThrow(/Cannot fit 8/);
  });
  it("builds all eight islands when requested with usable connected land and harbours", () => {
    const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 512, cellsZ: 512, landform: "archipelago",
      islandCount: 8, erosionDroplets: 200, rivers: 0, mountains: .35 });
    expect(world.playableIslands!.sites).toHaveLength(8);
    expect(world.playableIslands!.sites.every(site => site.buildingCount === 4 && site.harbour && site.headquarters)).toBe(true);
  }, 60000);
  it("calculates count ranges from usable island envelopes and channel spacing", () => {
    expect([64, 128, 192, 256, 512].map(size => maxPlayableIslandCount(size))).toEqual([1, 1, 4, 9, 36]);
    for (const size of [192, 256, 512]) {
      const maximum = maxPlayableIslandCount(size);
      const sites = planPlayableIslands({ cellsX: size, cellsZ: size }, 1234, false, maximum);
      expect(sites).toHaveLength(maximum);
      for (const site of sites) for (const other of sites) if (site !== other)
        expect(Math.hypot(other.x - site.x, other.z - site.z) - site.radius - other.radius).toBeGreaterThanOrEqual(25);
    }
  });
  it.each([7, 42, 1234, 2024])("fits one fully usable island on a 64 map (seed %i)", seed => {
    const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, seed,
      landform: "archipelago", islandCount: 1, erosionDroplets: 100, rivers: 0, forest: .35, mountains: .35 });
    expect(world.playableIslands!.sites).toHaveLength(1);
    expect(world.playableIslands!.sites[0]!.buildingCount).toBe(4);
    expect(world.playableIslands!.sites[0]!.harbour).toBeDefined();
  });
  it("keeps similar island envelopes equal and still has random layouts", () => {
    for (const seed of [7, 42, 1234, 2024]) {
      const sites = planPlayableIslands({ cellsX: 512, cellsZ: 512 }, seed, true);
      expect(new Set(sites.map(site => site.radius)).size).toBe(1);
    }
    expect(planPlayableIslands({ cellsX: 256, cellsZ: 256 }, 7)).not.toEqual(planPlayableIslands({ cellsX: 256, cellsZ: 256 }, 42));
  });
  it("aborts after the initial attempt and two retries when the map cannot fit navigable islands", () => {
    expect(ISLAND_SPACE.retries).toBe(2);
    // An unspecified count follows the size table (64: one island), so request more than fits.
    expect(() => cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, seed: 1234,
      landform: "archipelago", islandCount: 2, erosionDroplets: 200, rivers: 0 })).toThrow(/after three attempts/);
  });
  it("retains dimensions and validated harbour sites in exported maps", async () => {
    const world = create(192, 1234, true);
    const saved = await writeMapFile(world, { animals: [], name: "Playable islands", source: "generated", savedAt: 0 });
    const restored = await readMapFile(saved);
    expect(restored.world.playableIslands).toEqual(world.playableIslands);
  });
  it("None removes forest trees, while Few still grows some", () => {
    const trees = new Set<number>([PROP.broadleafTree, PROP.coniferTree, PROP.birchTree, PROP.palmTree, PROP.sapling]);
    const count = (forest: number) => {
      const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 128, cellsZ: 128, landform: "island", forest, erosionDroplets: 0, rivers: 0 });
      return world.props.types.filter(type => trees.has(type)).length;
    };
    expect(count(0)).toBe(0);
    expect(count(.35)).toBeGreaterThan(0);
    expect(count(.35)).toBeLessThan(count(1));
  });
});
