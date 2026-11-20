import { describe, expect, it } from "vitest";

import { getLayerLength, MAP_LAYERS } from "../src/shared/world/save/map-layers";
import { PROP, type WorldData } from "../src/shared/world/world-data";
import { createSyntheticDenseWorld } from "./helpers/synthetic-dense-world";

const countLandCells = (world: WorldData) => {
  const side = world.cellsX + 1;
  let land = 0;
  for (let cell = 0; cell < world.cellsX * world.cellsZ; cell += 1) {
    const column = cell % world.cellsX, row = Math.floor(cell / world.cellsX);
    if (world.heights[row * side + column]! > world.seaLevel) land += 1;
  }
  return land;
};

describe("synthetic dense world", () => {
  const world = createSyntheticDenseWorld({ cells: 128, seed: 7, treeSpacing: 1.2 });

  it("gives every stored layer its correct length", () => {
    const size = { cellsX: 128, cellsZ: 128, propCount: world.props.count };
    for (const spec of MAP_LAYERS) {
      const array = spec.get(world);
      if (!array) continue;
      expect(array.length, spec.name).toBe(getLayerLength(spec, size));
    }
    expect(world.fog.length).toBe(128 * 128);
    expect(world.normals.length).toBe(129 * 129 * 3);
  });

  it("covers the land with a dense forest", () => {
    const trees = world.props.types.subarray(0, world.props.count).filter((type) => type === PROP.broadleafTree);
    const treesPerLandCell = trees.length / countLandCells(world);
    expect(treesPerLandCell).toBeGreaterThan(0.2);
    expect(treesPerLandCell).toBeLessThan(0.5);
  });

  it("is deterministic", () => {
    const again = createSyntheticDenseWorld({ cells: 128, seed: 7, treeSpacing: 1.2 });
    expect(again.props.count).toBe(world.props.count);
    expect(again.heights).toEqual(world.heights);
    expect(again.props.x).toEqual(world.props.x);
  });
});
