import { describe, expect, it } from "vitest";

import { DEFAULT_WORLD_OPTIONS, type WorldOptions } from "../src/shared/world/generation/generate-world";
import { hasOreNearHome, hasStoneNearHome } from "../src/shared/world/generation/home-resources";
import { nationRiverAmount } from "../src/shared/world/generation/nation-terrain-bias";
import { getNationTerrainAffinity } from "../src/shared/world/nation-terrain-affinity";
import { ORE, PROP, type WorldData } from "../src/shared/world/world-data";
import { cachedWorld, freshWorldBeforeAll, preloadWorlds } from "./helpers/cached-worlds";

const SIZE = 96;
const SEED = 20_261_118;

const optionsFor = (nation: WorldOptions["nation"], patch: Partial<WorldOptions> = {}): WorldOptions => ({
  ...DEFAULT_WORLD_OPTIONS,
  cellsX: SIZE,
  cellsZ: SIZE,
  forest: 1,
  mountains: 1,
  nation,
  rivers: 0,
  seed: SEED,
  ...patch
});

const VIKING = optionsFor("viking");
const ROMAN = optionsFor("roman");
const JAPANESE = optionsFor("japanese");
const MAYA = optionsFor("maya");
const NEUTRAL = optionsFor(undefined);
preloadWorlds(VIKING, ROMAN, JAPANESE, MAYA, NEUTRAL);
const freshViking = freshWorldBeforeAll(VIKING);
const freshNeutral = freshWorldBeforeAll(NEUTRAL);

const countProp = (world: WorldData, kind: number) => {
  let count = 0;
  for (let index = 0; index < world.props.count; index += 1)
    if (world.props.types[index] === kind) count += 1;
  return count;
};

const riverCellCount = (world: WorldData) => world.riverDistance.reduce(
  (count, distance) => count + (distance < 0.5 ? 1 : 0), 0);

const meanLandMoisture = (world: WorldData) => {
  let sum = 0, land = 0;
  for (let vertex = 0; vertex < world.heights.length; vertex += 1) {
    if (world.heights[vertex]! <= world.seaLevel) continue;
    sum += world.moisture[vertex]!;
    land += 1;
  }
  return sum / Math.max(1, land);
};

describe("nation homeland generation bias", () => {
  it("keeps the home resource guarantee on national islands", () => {
    for (const options of [VIKING, MAYA, JAPANESE]) {
      const world = cachedWorld(options);
      expect([hasOreNearHome(world, ORE.coal), hasOreNearHome(world, ORE.iron), hasStoneNearHome(world)],
        String(options.nation)).toEqual([true, true, true]);
    }
  });

  it("grows more conifers on the Viking homeland than the Roman one", () => {
    expect(countProp(cachedWorld(VIKING), PROP.coniferTree))
      .toBeGreaterThan(countProp(cachedWorld(ROMAN), PROP.coniferTree));
  });

  it("keeps streams on the Japanese homeland even at the off river setting", () => {
    expect(riverCellCount(cachedWorld(JAPANESE))).toBeGreaterThan(riverCellCount(cachedWorld(ROMAN)));
    const japanese = getNationTerrainAffinity("japanese");
    expect(nationRiverAmount(2, japanese)).toBeGreaterThan(nationRiverAmount(2, getNationTerrainAffinity("roman")));
    expect(nationRiverAmount(0, japanese)).toBeGreaterThan(0);
    expect(nationRiverAmount(0, getNationTerrainAffinity("nubian"))).toBe(0);
  });

  it("keeps the Maya and Japanese homelands wetter than the Roman one", () => {
    const romanMoisture = meanLandMoisture(cachedWorld(ROMAN));
    expect(meanLandMoisture(cachedWorld(MAYA))).toBeGreaterThan(romanMoisture);
    expect(meanLandMoisture(cachedWorld(JAPANESE))).toBeGreaterThan(romanMoisture);
  });

  it("changes the generated landscape only when a nation is given", () => {
    expect(cachedWorld(NEUTRAL).splat).toEqual(freshNeutral().splat);
    expect(cachedWorld(NEUTRAL).splat).not.toEqual(cachedWorld(VIKING).splat);
    expect(cachedWorld(NEUTRAL).generationProvenance?.options.nation).toBeUndefined();
    expect(cachedWorld(VIKING).generationProvenance?.options.nation).toBe("viking");
  });

  it("is deterministic per nation and seed", () => {
    expect(freshViking().splat).toEqual(cachedWorld(VIKING).splat);
    expect(freshViking().moisture).toEqual(cachedWorld(VIKING).moisture);
    expect(freshViking().themeWeights).toEqual(cachedWorld(VIKING).themeWeights);
  });
});
