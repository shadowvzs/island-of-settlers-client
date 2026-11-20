import { describe, expect, it } from "vitest";

import { createGeologyMap } from "../src/render-common/rocks/geology";
import { createLabCliffTerrain } from "../src/render-common/rocks/lab-cliff";
import {
  buildMountainMasses,
  DEFAULT_MOUNTAIN_BUILDER
} from "../src/render-common/rocks/mountain-builder";
import { ROCK_ROLE } from "../src/render-common/rocks/rock-instances";
import { getGradient } from "../src/render-common/rocks/rock-terrain";

const cliff = { erosion: 0.1, geology: "mountain" as const, height: 10, seed: 38192 };
const terrain = createLabCliffTerrain(cliff);
const geology = createGeologyMap(terrain, cliff.seed, { forced: "mountain" });
const build = (overrides = {}) =>
  buildMountainMasses(terrain, geology, {
    ...DEFAULT_MOUNTAIN_BUILDER,
    seed: cliff.seed,
    ...overrides
  });

describe("mountain builder", () => {
  const masses = build();

  it("is deterministic per seed and differs between seeds", () => {
    expect(build()).toEqual(masses);
    expect(build({ seed: 7 })).not.toEqual(masses);
  });

  it("adds only a few summit stones and scree stones, nothing on steep faces", () => {
    const summit = masses.filter((mass) => mass.role === ROCK_ROLE.mass);
    const talus = masses.filter(
      (mass) => mass.role === ROCK_ROLE.pebble || mass.role === ROCK_ROLE.rubble
    );
    expect(masses.length).toBe(summit.length + talus.length);
    for (const stone of summit) {
      const slope = Math.hypot(...getGradient(terrain, stone.centre[0], stone.centre[2]));
      expect(slope).toBeLessThan(0.6);
    }
    expect(talus.every((stone) => Math.hypot(...stone.axes[0]) < 1.25)).toBe(true);
  });

  it("scales the summit and scree stones with the block size", () => {
    const width = (list: typeof masses, isSummit: boolean) => {
      const kept = list.filter((mass) => (mass.role === ROCK_ROLE.mass) === isSummit);
      return kept.reduce((sum, mass) => sum + Math.hypot(...mass.axes[0]), 0) / kept.length;
    };
    const large = build({ blockScale: 1.5, summit: 1 });
    const normal = build({ summit: 1 });
    for (const isSummit of [true, false]) {
      expect(width(large, isSummit)).toBeGreaterThan(width(normal, isSummit) * 1.3);
    }
  });
});
