import { afterEach, describe, expect, it, vi } from "vitest";

import type { CapturedGame } from "../src/app/save-store/captured-game";
import { stageGameSessionInWorker } from "../src/app/settlement/game-session-worker";
import { createSettlementSaveController } from "../src/app/settlement/settlement-save";
import { createWorkerVision } from "../src/render-common/workers/worker-vision";
import { createGameSave, type GameSaveV1,readGameSave } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { FOG } from "../src/shared/world/world-data";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";
import { createMemorySaveStore } from "./memory-save-store";

const WORLD_OPTIONS = { ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, erosionDroplets: 100 };
const PROVENANCE = { hash: "b".repeat(64), mapId: "2f1e7d42-9b0a-4c74-8f36-3f7aae3d9c11", revision: 7 };
preloadWorlds(WORLD_OPTIONS);

/** Stop at the first suitable seed; the remaining worlds are unused by the save test. */
const hiddenSectorWorld = () => {
  for (const seed of [1234, 1, 2, 3, 4, 5]) {
    const world = cachedWorld({ ...WORLD_OPTIONS, seed });
    if (world.fog.includes(FOG.hidden)) return world;
  }
  throw new Error("No hidden sector in the save-test seeds");
};

it("embeds the actual world, depletion, props, fog and survey state alongside its settlement", async () => {
  const world = cachedWorld(WORLD_OPTIONS);
  const roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ world, roads });
  // Permanent sight is the fog before the simulation's live sources (its owned land shows visible now).
  const startingFog = world.permanentFog!.slice();
  world.fog[0] = 2;
  world.oreAmount[0] = 0;
  if (world.mineZones[0]) world.mineZones[0].surveyed = true;
  const state = simulation.saveState();
  const saved = await createGameSave(
    world,
    state,
    { name: "Actual game", provenance: PROVENANCE, source: "chosen-island", savedAt: 123, animals: [] },
    { camera: { x: 3, z: 8 }, islandChoice: "chosen-island" }
  );
  expect(saved.mapProvenance).toEqual(PROVENANCE);
  const loaded = await readGameSave(JSON.parse(JSON.stringify(saved)));
  expect(loaded.mapProvenance).toEqual(PROVENANCE);
  expect(loaded.map.meta.provenance).toEqual(PROVENANCE);
  expect(loaded.map.world.heights).toEqual(world.heights);
  expect(loaded.map.world.props.types).toEqual(world.props.types);
  expect(loaded.map.world.oreAmount).toEqual(world.oreAmount);
  expect(loaded.map.world.fog).toEqual(world.fog.map((value, index) =>
    startingFog[index] === FOG.visible ? FOG.visible : Math.min(value, FOG.discovered)));
  expect(loaded.map.world.mineZones.map((zone) => zone.surveyed)).toEqual(
    world.mineZones.map((zone) => zone.surveyed)
  );
  expect(loaded.map.meta.source).toBe("chosen-island");
  expect(loaded.runtime).toEqual(saved.runtime);
  const restored = createSettlementSimulation({
    world: loaded.map.world,
    roads: createRoadNetwork(loaded.map.world)
  });
  expect(restored.loadState(loaded.settlement)).toEqual({ ok: true });
  expect(restored.saveState()).toEqual(state);
  // The non-browser fallback exercises the same detached staging validation as the codec worker.
  const staged = await stageGameSessionInWorker({ ...saved, runtime: undefined });
  expect(staged.settlement).toEqual(state);
  expect(staged.map.world.heights).toEqual(world.heights);
  const invalid = structuredClone(saved); invalid.runtime = undefined;
  invalid.settlement.buildings[0]!.inventory.logs = -1;
  await expect(stageGameSessionInWorker(invalid)).rejects.toThrow("Invalid shared storage pools");
  await expect(
    readGameSave({ ...saved, progress: { ...saved.progress, fog: { length: 1, packed: "/w==" } } })
  ).rejects.toThrow("Invalid saved island progress");
  await expect(
    readGameSave({ ...saved, progress: { ...saved.progress, permanentSight: { bits: "", length: 0 } } })
  ).rejects.toThrow("Invalid permanent exploration");
  await expect(readGameSave({ ...saved, mapProvenance: { ...PROVENANCE, hash: "x" } }))
    .rejects.toThrow("Invalid map provenance");
  await expect(readGameSave({ ...saved, version: 5 }))
    .rejects.toThrow("newer version");
  await expect(readGameSave({ ...saved, version: 3 }))
    .rejects.toThrow("Unsupported game save version");
  await expect(readGameSave({ ...saved, version: 2 }))
    .rejects.toThrow("Unsupported game save version");
  await expect(readGameSave({ ...saved, version: 0 }))
    .rejects.toThrow("Unsupported game save version");
  await expect(readGameSave({ ...saved, version: "1" }))
    .rejects.toThrow("Invalid game save version");
});

it("restores temporary sight as discovery, then lets live viewers reveal and release it", async () => {
  // A small island with a hidden sector (not every seed keeps one at 96 x 96).
  const world = hiddenSectorWorld();
  const target = world.fog.findIndex(value => value === FOG.hidden);
  expect(target).toBeGreaterThanOrEqual(0);
  const x = target % world.cellsX + 0.5, z = Math.floor(target / world.cellsX) + 0.5;
  createWorkerVision(world, 2).update(x, z);
  const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
  const saved = await createGameSave(world, simulation.saveState(),
    { name: "Temporary sight", source: "generated", savedAt: 123, animals: [] });
  const restored = (await readGameSave(saved)).map.world;
  expect(restored.fog[target]).toBe(FOG.discovered);
  const viewer = createWorkerVision(restored, 2);
  viewer.update(x, z);
  expect(restored.fog[target]).toBe(FOG.visible);
  viewer.suspend();
  expect(restored.fog[target]).toBe(FOG.discovered);
});

/** A save controller whose Import game picks `fileText` and answers the question with `confirm`. */
const importingController = (fileText: string, confirm: boolean) => {
  const { captures, store } = createMemorySaveStore(), notices: string[] = [], restored: unknown[] = [];
  let pick: (() => void) | undefined;
  const input = { accept: "", files: [{ text: async () => fileText }], type: "",
    addEventListener: (_event: string, listener: () => void) => { pick = listener; }, click: () => pick?.() };
  vi.stubGlobal("document", { createElement: () => input });
  const confirmImport = vi.fn(async () => confirm);
  const controller = createSettlementSaveController({
    captureGame: () => ({ save: [] }) as unknown as CapturedGame,
    captureSession: async () => ({ savedAt: 1 }) as GameSaveV1,
    confirmImport,
    restoreSession: async (value) => {
      restored.push(value);
      return { ok: true };
    },
    notify: (message) => notices.push(message),
    store
  });
  return { captures, confirmImport, controller, notices, restored };
};

describe("saving and importing", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("saves the captured game with the store's notice", async () => {
    const { captures, controller, notices } = importingController("{}", true);
    expect(await controller.save()).toBe(true);
    expect(captures).toHaveLength(1);
    expect(notices).toEqual(["Game saved in this browser."]);
  });

  it("imports a game file only after the player confirms replacing the current game", async () => {
    const accepted = importingController(JSON.stringify({ map: "imported" }), true);
    accepted.controller.importFile();
    await vi.waitFor(() => expect(accepted.restored).toEqual([{ map: "imported" }]));
    expect(accepted.notices).toEqual(["Game loaded."]);
    const declined = importingController(JSON.stringify({ map: "imported" }), false);
    declined.controller.importFile();
    await vi.waitFor(() => expect(declined.confirmImport).toHaveBeenCalled());
    expect(declined.restored).toEqual([]);
  });

  it("refuses a file that is not JSON before asking anything", async () => {
    const broken = importingController("broken-json", true);
    broken.controller.importFile();
    await vi.waitFor(() => expect(broken.notices).toHaveLength(1));
    expect(broken.notices[0]).toMatch(/not a game file/);
    expect(broken.confirmImport).not.toHaveBeenCalled();
    expect(await broken.controller.importJson("broken-json")).toBe(false);
    expect(broken.controller.isBusy()).toBe(false);
  });
});
