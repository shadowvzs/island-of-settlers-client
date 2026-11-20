import { describe, expect, it } from "vitest";

import { hasHomeFishingWater } from "../src/shared/settlement/home-fishing-water";
import { hasUsableOrePlot } from "../src/shared/settlement/settlement-ore-placement";
import { DEFAULT_WORLD_OPTIONS, type WorldOptions } from "../src/shared/world/generation/generate-world";
import {
  ensureHomeResources,
  hasOreNearHome,
  hasStoneNearHome
} from "../src/shared/world/generation/home-resources";
import { BLOCKING, ORE, PROP, PROP_REMOVED, type WorldData } from "../src/shared/world/world-data";
import { cachedWorld, freshWorldBeforeAll, preloadWorlds } from "./helpers/cached-worlds";

/** Flat islands (no mountains, so no mountain deposits or rock seams) and two mountain islands. */
const FLAT: WorldOptions = { ...DEFAULT_WORLD_OPTIONS, mountains: 0, seed: 1 };
const FLAT_ISLANDS: WorldOptions = { ...DEFAULT_WORLD_OPTIONS, landform: "archipelago", mountains: 0, seed: 2024 };
const MOUNTAINS: WorldOptions = { ...DEFAULT_WORLD_OPTIONS, seed: 3 };
const SEEDS = [FLAT, { ...FLAT, seed: 8 }, FLAT_ISLANDS, MOUNTAINS, DEFAULT_WORLD_OPTIONS];

const meetsGuarantee = (world: WorldData) =>
  [hasOreNearHome(world, ORE.coal), hasOreNearHome(world, ORE.iron), hasStoneNearHome(world)];

/** Cells of the deposits of an ore, as distances from the start. */
const oreDistances = (world: WorldData, ore: number) => {
  const distances: number[] = [];
  world.oreAmount.forEach((amount, cell) => {
    if (!amount || world.mineZones[world.mineZone[cell]! - 1]?.ore !== ore) return;
    distances.push(Math.hypot(cell % world.cellsX + .5 - world.start.x, Math.floor(cell / world.cellsX) + .5 - world.start.z));
  });
  return distances;
};

describe("home island resources", () => {
  preloadWorlds(...SEEDS);
  const fresh = freshWorldBeforeAll(FLAT);

  it.each(SEEDS.map(options => [options.seed, options.landform ?? "auto", options.mountains, options] as const))(
    "seed %i (%s, mountains %d) has coal, iron and quarry stone near the HQ", (_seed, _landform, _mountains, options) => {
      const world = cachedWorld(options);
      expect(meetsGuarantee(world)).toEqual([true, true, true]);
      expect(ensureHomeResources(world)).toBe(false);
    });

  it("keeps added outcrops clear of the HQ approach and the harbour", () => {
    for (const options of [FLAT, FLAT_ISLANDS]) {
      const world = cachedWorld(options);
      for (const ore of [ORE.coal, ORE.iron]) expect(Math.min(...oreDistances(world, ore))).toBeGreaterThan(12);
      const harbour = world.playableIslands?.sites[0]?.harbour;
      if (!harbour) continue;
      world.oreAmount.forEach((amount, cell) => {
        if (amount) expect(Math.hypot(cell % world.cellsX + .5 - harbour.x, Math.floor(cell / world.cellsX) + .5 - harbour.z))
          .toBeGreaterThan(8);
      });
    }
  });

  it("rims added outcrops with boulders yet keeps a usable mine plot", () => {
    for (const options of [FLAT, FLAT_ISLANDS]) {
      const world = cachedWorld(options);
      for (const ore of [ORE.coal, ORE.iron]) {
        const cells: number[] = [];
        world.oreAmount.forEach((amount, cell) => {
          if (amount && world.mineZones[world.mineZone[cell]! - 1]?.ore === ore) cells.push(cell);
        });
        expect(hasUsableOrePlot(world, cells, ore)).toBe(true);
      }
      const added = world.mineZones.filter(zone => zone.richness === .8 && zone.cellCount > 0);
      for (const zone of added) {
        let boulders = 0;
        for (let index = 0; index < world.props.count; index++) {
          const type = world.props.types[index];
          if (type !== PROP.largeRock && type !== PROP.smallRock) continue;
          if (Math.hypot(world.props.x[index]! - zone.centreX, world.props.z[index]! - zone.centreZ) < 7) boulders++;
        }
        expect(boulders).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("is deterministic per seed", () => {
    const world = fresh(), cached = cachedWorld(FLAT);
    expect(world.mineZones).toEqual(cached.mineZones);
    expect(world.oreAmount).toEqual(cached.oreAmount);
    expect(world.props.types).toEqual(cached.props.types);
    expect(world.splat).toEqual(cached.splat);
  });

  it("leaves a satisfied island untouched", () => {
    const world = cachedWorld(MOUNTAINS);
    const before = { count: world.props.count, splat: world.splat.slice(), zones: world.mineZones.length };
    expect(ensureHomeResources(world)).toBe(false);
    expect({ count: world.props.count, splat: world.splat, zones: world.mineZones.length }).toEqual(before);
  });

  it("adds quarry boulders when the island has no stone near the HQ", () => {
    const world = cachedWorld(FLAT);
    for (let index = 0; index < world.props.count; index++)
      if (world.props.types[index] === PROP.largeRock) world.props.types[index] = PROP_REMOVED;
    expect(hasStoneNearHome(world)).toBe(false);
    const count = world.props.count;
    expect(ensureHomeResources(world)).toBe(true);
    expect(hasStoneNearHome(world)).toBe(true);
    expect(world.props.types.slice(count, world.props.count).every(type => type === PROP.largeRock)).toBe(true);
  });

  it("finds fishable water for a home fishery, and none on an island without water", () => {
    expect(hasHomeFishingWater(cachedWorld(FLAT))).toBe(true);
    expect(hasHomeFishingWater(cachedWorld(FLAT_ISLANDS))).toBe(true);
    const world = cachedWorld(FLAT);
    world.blocking = world.blocking.map(value => value === BLOCKING.water ? BLOCKING.free : value);
    expect(hasHomeFishingWater(world)).toBe(false);
  });
});
