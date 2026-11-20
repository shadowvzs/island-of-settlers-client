import { describe, expect, it } from "vitest";

import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { getThemeParameters } from "../src/shared/world/generation/island-themes";
import {
  choosePalmForm,
  getPalmClusterPreference,
  getPalmScale
} from "../src/shared/world/generation/palm-rules";
import type { PropSample } from "../src/shared/world/generation/prop-rules";
import {
  chooseTreeSpecies,
  getCoastalWeight,
  getPalmShare,
  getTreeChance
} from "../src/shared/world/generation/tree-rules";
import { createRandom } from "../src/shared/world/rng";
import { encodeTreeForm, getFormArchetype, PALM } from "../src/shared/world/tree-forms";
import { PROP } from "../src/shared/world/world-data";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

const PALM_COUNT = Object.keys(PALM).length;

/** A palm spot on a sandy beach right by the sea (meadow for form tests). */
const BEACH: PropSample = {
  cluster: 0,
  coast: 2,
  curvature: 0,
  depth: 0,
  exposure: 0,
  forest: 0,
  forestSlopeX: 0,
  forestSlopeZ: 0,
  grain: 0,
  grove: 0,
  heatLoad: 0.5,
  height: 0.3,
  moisture: 0.5,
  mountainDistance: 40,
  patches: 0,
  plateau: 0,
  riverDistance: 30,
  rock: 0,
  rockSkin: 0,
  sand: 0.8,
  seaDistance: 2,
  slope: 0.05,
  species: 0,
  stand: 0,
  surfaceSlope: 0.05,
  trunkDistance: 2,
  vegetation: getThemeParameters("meadow").vegetation
};
const WARM_BEACH: PropSample = { ...BEACH, vegetation: getThemeParameters("desert").vegetation };

const DESERT = getThemeParameters("desert").vegetation;
const INLAND_DESERT: PropSample = {
  ...BEACH,
  coast: 12,
  sand: 0,
  seaDistance: 16,
  vegetation: DESERT
};
const ROCKY_DESERT: PropSample = { ...INLAND_DESERT, rock: 0.4, surfaceSlope: 0.7 };
const RIVER_FOREST: PropSample = {
  ...BEACH,
  coast: 2,
  forest: 0.7,
  moisture: 0.8,
  riverDistance: 2,
  sand: 0,
  seaDistance: 20
};

/** Share of each variant picked at a spot over all cluster noise regions. */
const getShares = (sample: PropSample, trials = 1200) => {
  const random = createRandom(9);
  const counts = Array.from({ length: PALM_COUNT }, () => 0);
  for (let index = 0; index < trials; index += 1) {
    const species = (index % 40) / 20 - 1;
    const stand = Math.floor(index / 40) / 15 - 1;
    counts[getFormArchetype(choosePalmForm({ ...sample, species, stand }, random))]! += 1;
  }
  return counts.map((count) => count / trials);
};

const isLargest = (shares: number[], archetype: number) =>
  shares.every((share, index) => index === archetype || share < shares[archetype]!);

describe("palm placement", () => {
  it("puts coconuts on the beach, date palms in the dry inland, fan palms on rocky warm spots", () => {
    expect(isLargest(getShares(BEACH), PALM.coconut)).toBe(true);
    expect(isLargest(getShares(INLAND_DESERT), PALM.date)).toBe(true);
    const rocky = getShares(ROCKY_DESERT);
    expect(isLargest(rocky, PALM.fan)).toBe(true);
    expect(rocky[PALM.fan]!).toBeGreaterThan(getShares(INLAND_DESERT)[PALM.fan]! * 1.2);
  });

  it("puts pygmy date and ground palms by the water and in the understorey", () => {
    const sheltered = getShares(RIVER_FOREST);
    const beach = getShares(BEACH);
    expect(sheltered[PALM.ground]! + sheltered[PALM.pygmyDate]!).toBeGreaterThan(0.4);
    expect(beach[PALM.ground]! + beach[PALM.pygmyDate]!).toBeLessThan(0.15);
  });

  it("keeps the old leaning hero rare and on the beach edge only", () => {
    expect(getShares(BEACH)[PALM.leaning]!).toBeGreaterThan(0);
    expect(getShares(BEACH)[PALM.leaning]!).toBeLessThan(0.06);
    expect(getShares(INLAND_DESERT)[PALM.leaning]!).toBe(0);
    expect(getShares(RIVER_FOREST)[PALM.leaning]!).toBe(0);
    const hero = encodeTreeForm(PALM.leaning, 0);
    expect(getPalmScale(BEACH, hero, createRandom(1))).toBeGreaterThan(1.08);
  });

  it("clusters variants in space: preferences change smoothly with the noise", () => {
    const near = { ...BEACH, species: 0.3, stand: 0.1 };
    const next = { ...BEACH, species: 0.31, stand: 0.105 };
    for (const archetype of Object.values(PALM)) {
      const difference = Math.abs(
        getPalmClusterPreference(near, archetype) - getPalmClusterPreference(next, archetype)
      );
      expect(difference).toBeLessThan(0.15);
    }
  });

  const ISLAND_128 = { ...DEFAULT_WORLD_OPTIONS, cellsX: 128, cellsZ: 128, theme: "desert" as const };
  preloadWorlds(ISLAND_128);
  it("gives a generated island every common variant, mostly sharing a form with neighbours", () => {
    const world = cachedWorld(ISLAND_128);
    const { props } = world;
    const palms: number[] = [];
    for (let index = 0; index < props.count; index += 1) {
      if (props.types[index] === PROP.palmTree) palms.push(index);
    }
    const counts = Array.from({ length: PALM_COUNT }, () => 0);
    for (const index of palms) counts[getFormArchetype(props.form[index]!)]! += 1;
    for (const archetype of [PALM.coconut, PALM.date, PALM.ground]) {
      expect(counts[archetype]).toBeGreaterThan(0);
    }
    let same = 0;
    let pairs = 0;
    for (const index of palms) {
      let nearest = -1;
      let distance = 3;
      for (const other of palms) {
        const gap = Math.hypot(
          props.x[index]! - props.x[other]!,
          props.z[index]! - props.z[other]!
        );
        if (other !== index && gap < distance) [nearest, distance] = [other, gap];
      }
      if (nearest < 0) continue;
      pairs += 1;
      if (props.form[nearest] === props.form[index]) same += 1;
    }
    const shares = counts.map((count) => count / palms.length);
    const random = shares.reduce((sum, share) => sum + share * share, 0);
    expect(same / pairs).toBeGreaterThan(random);
  });

  it("lets palms grow deep inland on warm sand only; temperate ground keeps no palms", () => {
    const deep = { cluster: 0.5, coast: 40, grain: 0.3, height: 1.5, seaDistance: 60 };
    const sand: PropSample = { ...WARM_BEACH, ...deep, sand: 0.8, vegetation: DESERT };
    expect(getTreeChance(sand)).toBeGreaterThan(0.1);
    expect(chooseTreeSpecies(sand, createRandom(3))).toBe(PROP.palmTree);
    const temperate = { ...sand, vegetation: getThemeParameters("meadow").vegetation };
    expect(getTreeChance(temperate)).toBe(0);
    expect(chooseTreeSpecies(temperate, createRandom(3))).not.toBe(PROP.palmTree);
    const grass: PropSample = { ...BEACH, ...deep, forest: 0.6, sand: 0, vegetation: getThemeParameters("meadow").vegetation };
    expect(getCoastalWeight(grass)).toBe(0);
    const random = createRandom(4);
    for (let index = 0; index < 200; index += 1) {
      expect(chooseTreeSpecies(grass, random)).not.toBe(PROP.palmTree);
    }
  });

  it("keeps the forest floor away from palm groves: palm share by site", () => {
    const coastGrass: PropSample = { ...BEACH, coast: 6, sand: 0, seaDistance: 6 };
    const deepGrass: PropSample = { ...coastGrass, coast: 40, height: 1.5, seaDistance: 60 };
    expect(getPalmShare(WARM_BEACH)).toBe(1);
    expect(getPalmShare({ ...coastGrass, vegetation: DESERT })).toBeGreaterThan(0.9);
    expect(getPalmShare(deepGrass)).toBe(0);
    expect(getPalmShare({ ...deepGrass, vegetation: DESERT })).toBeGreaterThan(0.9);
    const snowy = getThemeParameters("snowy").vegetation;
    expect(getPalmShare({ ...coastGrass, vegetation: snowy })).toBe(0);
    expect(getPalmShare(BEACH)).toBe(0);
  });
});
