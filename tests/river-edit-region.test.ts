import { describe, expect, it } from "vitest";

import { editAuthoredRiver } from "../src/shared/world/editing/authored-rivers";
import { editGeneratedRiver } from "../src/shared/world/editing/generated-river-edit";
import { eraseRiverWater } from "../src/shared/world/editing/river-water-eraser";
import { refreshEditedTerrain } from "../src/shared/world/editing/terrain/terrain-apply";
import type { CellRegion } from "../src/shared/world/grid-geometry";
import type { WorldData } from "../src/shared/world/world-data";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld } from "./helpers/cached-worlds";

/** Derived layers a terrain refresh writes (props excluded: re-anchoring is checked elsewhere). */
const DERIVED_LAYERS = [
  "ambientOcclusion", "blocking", "buildCap", "buildClass", "coastDistance", "heightLevels", "normals",
  "riverDistance", "slopeClass", "sunShadow", "walkCost", "wetRock"
] as const;

/** The local refresh of a river edit leaves the world as a whole-map refresh would. */
const expectLikeFullRefresh = (world: WorldData) => {
  const full = structuredClone(world);
  refreshEditedTerrain(full, { minX: 0, minZ: 0, maxX: world.cellsX - 1, maxZ: world.cellsZ - 1 }, true);
  for (const layer of DERIVED_LAYERS) expect(world[layer], layer).toEqual(full[layer]);
};

const expectLocal = (world: WorldData, cells: CellRegion) => {
  expect(cells.maxX - cells.minX).toBeLessThan(world.cellsX - 1);
  expect(cells.maxZ - cells.minZ).toBeLessThan(world.cellsZ - 1);
};

describe("river edits refresh only the changed region", () => {
  it("draws, erases and removes an authored river locally, as a whole-map refresh would", () => {
    const world = structuredClone(cachedWorld({ ...SMALL_EDITOR_WORLD, rivers: 0 }));
    const river = { id: 1, points: [{ x: 24, z: 24 }, { x: 32, z: 35 }, { x: 40, z: 46 }], width: 2, depth: .7 };
    const drawn = editAuthoredRiver(world, river);
    expectLocal(world, drawn);
    expect(drawn.minX).toBeLessThanOrEqual(24); expect(drawn.maxZ).toBeGreaterThanOrEqual(45);
    expectLikeFullRefresh(world);
    expectLocal(world, eraseRiverWater(world, { x: 32, z: 35 }, 2));
    expectLikeFullRefresh(world);
    expectLocal(world, editAuthoredRiver(world, null, 1));
    expectLikeFullRefresh(world);
  });

  it("resizes a generated river locally, as a whole-map refresh would", () => {
    const world = structuredClone(cachedWorld(SMALL_EDITOR_WORLD));
    const generated = world.generatedRivers![0]!;
    editGeneratedRiver(world, { ...generated, widthScale: 1.5 }, generated.id);
    expectLikeFullRefresh(world);
  });
});
