import type { CharacterLodLevel } from "@workers/character-lods/lod-policy";
import { describe, expect, it } from "vitest";

import { explorationPrewarmLevels } from "../src/renderers/three/worker-lod-sources";

const access = (base: CharacterLodLevel, levels: readonly CharacterLodLevel[]) => ({
  base,
  has: (level: CharacterLodLevel) => levels.includes(level)
});

describe("exploration hero level prewarm", () => {
  it("loads the approach level and the sun shadow proxy above the preset's base", () => {
    expect(explorationPrewarmLevels(access(0, [0, 1, 2, 3]))).toEqual([1, 2]);
  });

  it("never loads a level the preset does not show", () => {
    expect(explorationPrewarmLevels(access(1, [0, 1, 2, 3]))).toEqual([2]);
    expect(explorationPrewarmLevels(access(2, [0, 1, 2, 3]))).toEqual([]);
  });

  it("skips a level without an authored file and accepts a body without levels", () => {
    expect(explorationPrewarmLevels(access(0, [0, 1]))).toEqual([1]);
    expect(explorationPrewarmLevels(undefined)).toEqual([]);
  });
});
