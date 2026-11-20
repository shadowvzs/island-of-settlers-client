import { describe, expect, it } from "vitest";

import { countSettlementLand, createBuildClass } from "../src/shared/world/build-class";
import {
  BUILDING_FOOTPRINTS,
  type BuildingFootprint,
  getFootprintMinimums
} from "../src/shared/world/building-footprints";
import {
  type BuildSite,
  countAllFootprints,
  countFootprints,
  fitsFootprint,
  getFootprintShortfall,
  packAround} from "../src/shared/world/building-space";
import { START_AREA } from "../src/shared/world/generation/clearings";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { BUILD } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

const RECTANGULAR_FOOTPRINTS = {
  wide: { size: 3, width: 3, depth: 2, maxRise: 0.5 },
  deep: { size: 3, width: 2, depth: 3, maxRise: 0.5 }
} as const satisfies Record<string, BuildingFootprint>;

/** Synthetic site: every cell the given build class, heights from a function of the vertex. */
const createSite = (
  size: number,
  buildClass: number = BUILD.large,
  getHeight: (x: number, z: number) => number = () => 1
): BuildSite => {
  const heights = new Float32Array((size + 1) * (size + 1));
  heights.forEach((_, index) => {
    heights[index] = getHeight(index % (size + 1), Math.floor(index / (size + 1)));
  });
  return {
    buildClass: new Uint8Array(size * size).fill(buildClass),
    cellsX: size,
    cellsZ: size,
    heights
  };
};

const setCell = (site: BuildSite, x: number, z: number, buildClass: number) => {
  site.buildClass[z * site.cellsX + x] = buildClass;
};

describe("footprint packing", () => {
  it("packs foundations plus their access strip without overlap", () => {
    expect(countAllFootprints(createSite(12))).toEqual({ large: 9, standard: 16, tower: 36 });
  });

  it("places 2x3 and 3x2 plots without requiring an extra square foundation row", () => {
    const site = createSite(4);
    setCell(site, 2, 0, BUILD.flag);
    expect(fitsFootprint(site, new Uint8Array(16), 0, 0, RECTANGULAR_FOOTPRINTS.deep)).toBe(true);
    expect(fitsFootprint(site, new Uint8Array(16), 0, 0, RECTANGULAR_FOOTPRINTS.wide)).toBe(false);
    setCell(site, 2, 0, BUILD.large);
    setCell(site, 0, 2, BUILD.flag);
    expect(fitsFootprint(site, new Uint8Array(16), 0, 0, RECTANGULAR_FOOTPRINTS.wide)).toBe(true);
    expect(fitsFootprint(site, new Uint8Array(16), 0, 0, RECTANGULAR_FOOTPRINTS.deep)).toBe(false);
    expect(countFootprints(createSite(12), RECTANGULAR_FOOTPRINTS.deep)).toBe(12);
    expect(countFootprints(createSite(12), RECTANGULAR_FOOTPRINTS.wide)).toBe(12);
  });

  it("needs buildable foundation cells but only passable access cells", () => {
    const site = createSite(3);
    const taken = new Uint8Array(9);
    const { standard } = BUILDING_FOOTPRINTS;
    setCell(site, 2, 1, BUILD.flag);
    expect(fitsFootprint(site, taken, 0, 0, standard)).toBe(true);
    setCell(site, 1, 1, BUILD.flag);
    expect(fitsFootprint(site, taken, 0, 0, standard)).toBe(false);
    setCell(site, 1, 1, BUILD.mine);
    expect(fitsFootprint(site, taken, 0, 0, standard)).toBe(false);
  });

  it("rejects a blocked access strip and the map border", () => {
    const site = createSite(3);
    const { standard } = BUILDING_FOOTPRINTS;
    setCell(site, 2, 2, BUILD.none);
    expect(fitsFootprint(site, new Uint8Array(9), 0, 0, standard)).toBe(false);
    expect(fitsFootprint(createSite(2), new Uint8Array(4), 0, 0, standard)).toBe(false);
  });

  it("limits the height difference a foundation can absorb", () => {
    const gentle = createSite(12, BUILD.small, (x) => x * 0.15);
    const steep = createSite(12, BUILD.small, (x) => x * 0.4);
    expect(countFootprints(gentle, BUILDING_FOOTPRINTS.standard)).toBe(16);
    expect(countFootprints(gentle, BUILDING_FOOTPRINTS.large)).toBe(9);
    expect(countFootprints(steep, BUILDING_FOOTPRINTS.tower)).toBe(0);
  });

  it("places a plan around a centre, nearest first, within the radius", () => {
    const site = createSite(20);
    const centre = { x: 10, z: 10 };
    expect(packAround(site, centre, 6, ["large", "standard", "standard", "tower"])).toBe(4);
    expect(packAround(site, centre, 1, ["large", "large"])).toBe(1);
  });

  it("weights the island minimums to the building mix and the land area", () => {
    const small = getFootprintMinimums(2000);
    const large = getFootprintMinimums(32000);
    expect(large.standard).toBeGreaterThan(small.standard * 15);
    expect(large.standard).toBeGreaterThan(large.tower);
    expect(large.tower).toBeGreaterThan(large.large);
  });
});

/** World generation takes ~1 s at 256 x 256 (more under a loaded test runner). */
const WORLD_TIMEOUT = 30_000;

/**
 * Every map size: the default seed, seeds that need planned clearings (23770, 31689) and random
 * ones; the 256 maps are the slowest, so they get the fewest seeds.
 */
const CASES: [size: number, seed: number][] = [
  [64, 1234],
  [64, 23770],
  [64, 63365],
  [128, 1234],
  [128, 7932],
  [128, 23770],
  [128, 31689],
  [256, 1234],
  [256, 31689]
];

describe("building space of generated islands", () => {
  it.each(CASES)(
    "%i map, seed %i meets the minimums and fits the start settlement",
    (size, seed) => {
      const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: size, cellsZ: size, seed });
      const landCells = countSettlementLand(world);
      const { maxRadius, plan } = START_AREA;
      // The island minimums count the land once the trees are felled; the start fits at once.
      const felled = { ...world, buildClass: createBuildClass(world, false) };
      expect(getFootprintShortfall(felled, landCells)).toBe(0);
      expect(packAround(world, world.start, maxRadius, plan)).toBe(plan.length);
    },
    WORLD_TIMEOUT
  );
});
