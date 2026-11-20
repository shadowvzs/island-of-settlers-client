import { describe, expect, it } from "vitest";

import { createGeologyMap } from "../src/render-common/rocks/geology";
import { createLabCliffTerrain, LAB_SIZE } from "../src/render-common/rocks/lab-cliff";
import {
  buildMountainMasses,
  DEFAULT_MOUNTAIN_BUILDER
} from "../src/render-common/rocks/mountain-builder";
import { ROCK_ROLE } from "../src/render-common/rocks/rock-instances";
import { placeRocks } from "../src/render-common/rocks/rock-placement";
import { ROCK_FAMILY } from "../src/render-common/rocks/rock-shapes";
import { createTalusField } from "../src/render-common/rocks/rock-talus";

const SEED = 38192;
const STEP = 0.5;

const createCliff = (height: number) => {
  const terrain = createLabCliffTerrain({ erosion: 0.1, geology: "mountain", height, seed: SEED });
  const geology = createGeologyMap(terrain, SEED, { forced: "mountain" });
  return { geology, talus: createTalusField(terrain, geology, SEED), terrain };
};

/** Highest talus amount per column along the foot (the cliff runs along x). */
const getFootProfile = (height: number) => {
  const { talus } = createCliff(height);
  const profile: number[] = [];
  for (let x = 2; x < LAB_SIZE - 2; x += STEP) {
    let highest = 0;
    for (let z = 2; z < LAB_SIZE - 2; z += STEP) highest = Math.max(highest, talus(x, z).amount);
    profile.push(highest);
  }
  return profile;
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe("talus at the mountain foot", () => {
  const short = getFootProfile(1.5);
  const tall = getFootProfile(6);

  it("collects below tall faces, little or none below short ones", () => {
    const middle = getFootProfile(3);
    expect(sum(short)).toBeLessThan(sum(tall) * 0.25);
    expect(sum(short)).toBeLessThan(sum(middle));
    expect(sum(middle)).toBeLessThan(sum(tall));
  });

  it("forms fans and gaps along the foot, not a uniform ring", () => {
    const sorted = [...tall].sort((a, b) => a - b);
    const low = sorted[Math.floor(sorted.length * 0.2)]!;
    const high = sorted[Math.floor(sorted.length * 0.9)]!;
    expect(high).toBeGreaterThan(0.6);
    expect(low).toBeLessThan(high * 0.4);
  });

  it("places angular blocks (no round boulders) and scree only on the talus", () => {
    const { geology, talus, terrain } = createCliff(6);
    const blocks = placeRocks(terrain, { geology: "mountain", seed: SEED }).filter(
      ({ role }) => role === ROCK_ROLE.outcrop || role === ROCK_ROLE.rubble
    );
    expect(blocks.length).toBeGreaterThan(5);
    const masses = buildMountainMasses(terrain, geology, {
      ...DEFAULT_MOUNTAIN_BUILDER,
      seed: SEED
    });
    const scree = masses.filter(({ role }) => role !== ROCK_ROLE.mass);
    expect(scree.length).toBeGreaterThan(blocks.length);
    for (const stone of [...blocks, ...scree]) {
      expect(stone.family).not.toBe(ROCK_FAMILY.weathered);
      expect(talus(stone.centre[0], stone.centre[2]).amount).toBeGreaterThan(0);
    }
  });
});
