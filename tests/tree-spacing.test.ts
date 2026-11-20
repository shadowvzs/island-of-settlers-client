import { describe, expect, it } from "vitest";

import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { PROP } from "../src/shared/world/world-data";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

const BASE = {
  ...DEFAULT_WORLD_OPTIONS,
  cellsX: 128,
  cellsZ: 128,
  erosionDroplets: 4000,
  forest: 2,
  seed: 7
};
const DENSE = { ...BASE, treeSpacing: 1.2 };
const TREE_TYPES = new Set<number>([PROP.birchTree, PROP.broadleafTree, PROP.coniferTree, PROP.palmTree]);

preloadWorlds(BASE, DENSE);

describe("forest density", () => {
  it("places at least 1.5 times as many trees at spacing 1.2", () => {
    const normal = cachedWorld(BASE), dense = cachedWorld(DENSE);
    const count = (world: typeof normal) => {
      let trees = 0;
      for (let index = 0; index < world.props.count; index += 1)
        if (TREE_TYPES.has(world.props.types[index]!)) trees += 1;
      return trees;
    };
    const normalTrees = count(normal), denseTrees = count(dense);
    expect(normalTrees).toBeGreaterThan(0);
    expect(denseTrees).toBeGreaterThanOrEqual(normalTrees * 1.5);
  });
});
