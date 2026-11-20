import { expect, it } from "vitest";

import { createCameraBookmarks } from "../src/app/camera-bookmarks";
import { stageGameSessionInWorker } from "../src/app/settlement/game-session-worker";
import { createCamera } from "../src/render-common/camera-state";
import { createGameSave } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

const WORLD_OPTIONS = { ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, erosionDroplets: 100 };
preloadWorlds(WORLD_OPTIONS);

it("loads optional bookmarks through detached game validation and rejects malformed imported views", async () => {
  const world = cachedWorld(WORLD_OPTIONS);
  const sim = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
  const store = createCameraBookmarks(),
    camera = createCamera(20, 20, 1);
  store.add("Harbour", camera, "iso");
  const { centerX, centerZ, tilt, yaw, zoom } = camera;
  const saved = await createGameSave(
    world,
    sim.saveState(),
    { name: "Bookmark save", source: "generated", savedAt: 1, animals: [] },
    {
      bookmarks: store.list(),
      camera: { centerX, centerZ, tilt, yaw, zoom },
      growth: {
        now: 0,
        running: true,
        speed: 1,
        trees: [],
        grown: [],
        jobPlanted: [],
        planted: [],
        removed: []
      },
      felling: { now: 0, randomState: 1, controller: { lastTime: 0, fellings: [] }, fallYaws: [] }
    }
  );
  const loaded = await stageGameSessionInWorker(saved);
  expect((loaded.runtime as any).bookmarks).toEqual(store.list());
  const invalid = structuredClone(saved);
  (invalid.runtime as any).bookmarks[0].camera.centerX = Infinity;
  await expect(stageGameSessionInWorker(invalid)).rejects.toThrow("Invalid saved camera bookmarks");
  delete (saved.runtime as any).bookmarks;
  await expect(stageGameSessionInWorker(saved)).resolves.toBeDefined();
});
