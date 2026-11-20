import { expect, it } from "vitest";

import { createGameSaveInWorker } from "../src/app/settlement/game-session-worker";
import { readGameSave } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

preloadWorlds(SMALL_EDITOR_WORLD);
it("detaches workerless saves before module loading can mix later material, road and runtime state", async () => {
  const world = cachedWorld(SMALL_EDITOR_WORLD);
  world.colonyResourceTier = 4;
  world.colonyStoneDeposits = [{ id: 0, material: "granite", remaining: 17, x: 2.5, z: 2.5 }];
  const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
  const settlement = simulation.saveState();
  settlement.roads = [{ start: { x: 2, z: 2 }, end: { x: 2.5, z: 2 }, tier: "granite" }];
  const height = world.heights[0]!, runtime = { camera: { zoom: 3 } };
  const pending = createGameSaveInWorker(world, settlement,
    { name: "Boundary", source: "chosen-island", savedAt: 10, animals: [] }, runtime);
  world.heights[0] = height + 1;
  world.colonyResourceTier = 1;
  world.colonyStoneDeposits[0]!.remaining = 0;
  settlement.roads[0]!.tier = "dirt";
  runtime.camera.zoom = 9;
  const loaded = await readGameSave(await pending);
  expect(loaded.map.world.heights[0]).toBe(height);
  expect(loaded.map.world.colonyResourceTier).toBe(4);
  expect(loaded.map.world.colonyStoneDeposits?.[0]?.remaining).toBe(17);
  expect(loaded.settlement.roads[0]?.tier).toBe("granite");
  expect(loaded.runtime).toEqual({ camera: { zoom: 3 } });
});
