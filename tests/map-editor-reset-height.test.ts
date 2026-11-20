import { expect, it } from "vitest";

import { applyWorldDiff, createWorldSnapshot } from "../src/shared/world/editing/history/world-diff";
import { applyStampChanges } from "../src/shared/world/editing/terrain/terrain-apply";
import { addStamp, createTerrainEditState, removeStampsNear } from "../src/shared/world/editing/terrain/terrain-edit-state";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { writeMapFile } from "../src/shared/world/save/map-writer";
import { BUILD } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

it("reclaims original seabed, keeps the new baseline through terrain edits, and undoes/redoes it", async () => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, erosionDroplets: 100, rivers: 0 });
  const state = createTerrainEditState();
  const x = 8, z = 8, vertex = z * 65 + x;
  // Reproduce an original, unedited patch of ocean.
  for (let zz = 0; zz < 20; zz++) for (let xx = 0; xx < 20; xx++) {
    const i = zz * 65 + xx;
    world.heights[i] = world.seaLevel - 3;
    world.waterSurface[i] = world.seaLevel;
    world.waterDepth[i] = 3;
  }
  const snapshot = createWorldSnapshot(world, state);
  snapshot.capture();
  const result = applyStampChanges(world, state, [], null, [{ x, z, radius: 7 }]);
  expect(result.waterChanged).toBe(true);
  expect(world.heights[vertex]).toBe(world.seaLevel + 2);
  expect(world.waterDepth[vertex]).toBe(0);
  expect(world.buildCap[z * 64 + x]).toBe(BUILD.large);
  const diff = snapshot.diff()!;
  applyWorldDiff(world, state, diff, "before");
  expect(world.heights[vertex]).toBe(world.seaLevel - 3);
  expect(state.base!.heights[vertex]).toBe(world.seaLevel - 3);
  applyWorldDiff(world, state, diff, "after");
  const change = addStamp(state, { x, z }, 3, 42);
  applyStampChanges(world, state, [change]);
  applyStampChanges(world, state, removeStampsNear(state, x, z, 7));
  expect(world.heights[vertex]).toBe(world.seaLevel + 2);
  expect(world.waterDepth[vertex]).toBe(0);
  const saved = await writeMapFile(world, { name: "Reclaimed land", source: "generated", savedAt: 0, animals: [], terrain: state });
  const restored = await readMapFile(saved);
  expect(restored.world.heights[vertex]).toBe(world.seaLevel + 2);
  expect(restored.world.waterDepth[vertex]).toBe(0);
});
