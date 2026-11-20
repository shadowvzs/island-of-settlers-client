import { describe, expect, it, type Mock, vi } from "vitest";

import {
  createExplorationCameraBoundary,
  type ExplorationAppearanceLease,
  type ExplorationCameraBoundary,
  type ExplorationGroundQuery,
  type ExplorationHost,
  type ExplorationSessionIdentity,
  type HomeExplorationContext
} from "../src/app/exploration/contracts";
import { createExplorationController } from "../src/app/exploration/session";
import type { GameRuntimeState } from "../src/app/settlement/game-session";
import type { CameraState } from "../src/render-common/camera-state";
import { createGameSave, readGameSave } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

/**
 * EXPLORE-01H save-boundary evidence. The capture helper mirrors the production island capture
 * (`island-of-settlers-client/src/app/island-settlement-boot.ts`): the runtime camera is read from
 * `ExplorationCameraBoundary.savedRts()`, never from the transient render frame.
 *
 * The first test is pure and asserts the decoded save-shaped payload is byte-identical across every
 * exploration phase. The second test runs the same boundary through the real `createGameSave` /
 * `readGameSave` codec so the claim is about a real decoded GameSaveV1, not only a local object.
 * Live-boot cases stay skipped until EXPLORE-01G exposes `window.__exploration`.
 */

const WORLD_OPTIONS = {
  ...DEFAULT_WORLD_OPTIONS,
  cellsX: 96,
  cellsZ: 96,
  erosionDroplets: 100,
  seed: 1234
};
preloadWorlds(WORLD_OPTIONS);

const RTS: CameraState = {
  centerX: 16, centerZ: 22, tilt: 0.1, viewportHeight: 900, viewportWidth: 1440,
  yaw: 0.25, zoom: 1.35
};

const RTS_CAMERA_FIELDS = ["centerX", "centerZ", "tilt", "yaw", "zoom"] as const;

/** Transient exploration names that must never appear in a decoded island runtime. */
const FORBIDDEN_RUNTIME_KEYS = [
  "bubble",
  "cooldown",
  "exploration",
  "explorationFrame",
  "explorationPhase",
  "explorer",
  "eyeHeight",
  "firstPerson",
  "fov",
  "fpsPose",
  "pose",
  "presentationSeed",
  "smoke",
  "spyglass",
  "temporaryFog"
] as const;

const LIVE_HOOK_REASON =
  "Blocked until EXPLORE-01G: requires the live settlement boot and window.__exploration; " +
  "the current build has no exploration runtime hook.";

const homeContext = (changes: Partial<HomeExplorationContext> = {}): HomeExplorationContext => ({
  activeAdventure: null,
  activeColony: null,
  editor: false,
  homeIsland: true,
  playback: false,
  sandbox: false,
  settlement: true,
  ...changes
});

const BOOKMARK: NonNullable<GameRuntimeState["bookmarks"]>[number] = {
  camera: { centerX: 9, centerZ: 11, tilt: 0.05, yaw: 0, zoom: 1.2 },
  name: "Home harbour",
  viewMode: "iso"
};

/** The island-capture camera projection: only the five saved RTS fields, never an eye pose. */
const captureRuntime = (boundary: ExplorationCameraBoundary): GameRuntimeState => {
  const { centerX, centerZ, tilt, yaw, zoom } = boundary.savedRts();
  return {
    bookmarks: [{ ...BOOKMARK, camera: { ...BOOKMARK.camera } }],
    camera: { centerX, centerZ, tilt, yaw, zoom },
    environment: {
      cycling: true,
      day: 3,
      hour: 9,
      rain: 0.2,
      snow: 0,
      targetHour: 10,
      targetRain: 0.4,
      targetSnow: 0
    },
    felling: {
      controller: { fellings: [], lastTime: 0 },
      fallYaws: [],
      now: 0,
      previous: null,
      randomState: 1
    },
    growth: {
      grown: [],
      jobPlanted: [],
      now: 0,
      planted: [],
      removed: [],
      running: true,
      speed: 1,
      trees: []
    },
    viewMode: "iso"
  };
};

const objectKeys = (value: unknown, found: string[] = []): string[] => {
  if (Array.isArray(value)) {
    for (const item of value) objectKeys(item, found);
    return found;
  }
  if (!value || typeof value !== "object") return found;
  for (const [key, item] of Object.entries(value)) {
    found.push(key);
    objectKeys(item, found);
  }
  return found;
};

const forbiddenRuntimeKeys = (value: unknown) =>
  objectKeys(value).filter(key => (FORBIDDEN_RUNTIME_KEYS as readonly string[]).includes(key));

const expectOrdinaryRtsCamera = (runtime: unknown) => {
  const camera = (runtime as GameRuntimeState).camera;
  expect(Object.keys(camera).sort()).toEqual([...RTS_CAMERA_FIELDS].sort());
  expect(camera).toEqual({
    centerX: RTS.centerX,
    centerZ: RTS.centerZ,
    tilt: RTS.tilt,
    yaw: RTS.yaw,
    zoom: RTS.zoom
  });
  expect(forbiddenRuntimeKeys(runtime)).toEqual([]);
};

const createHarness = () => {
  let nowValue = 0;
  const identity: ExplorationSessionIdentity = {
    accountId: "account", generation: 1, islandKey: "home", slotId: "slot"
  };
  const groundFlags = { clear: true, owned: true, walkable: true, water: false };
  const boundary = createExplorationCameraBoundary(RTS);
  const lease: ExplorationAppearanceLease & { dispose: Mock<() => void> } = {
    dispose: vi.fn<() => void>(),
    update: vi.fn()
  };
  const ground: ExplorationGroundQuery = {
    cellsX: 32,
    cellsZ: 32,
    groundHeight: () => 0,
    isClear: () => groundFlags.clear,
    isOwned: () => groundFlags.owned,
    isWalkable: () => groundFlags.walkable,
    isWater: () => groundFlags.water
  };
  const host: ExplorationHost = {
    appearance: { acquire: async () => lease },
    camera: boundary,
    ground,
    identity: () => ({ ...identity }),
    now: () => nowValue,
    smoke: { burst: vi.fn(), dispose: vi.fn(), update: vi.fn() },
    ui: { dispose: vi.fn(), publish: vi.fn() },
    visibility: { dispose: vi.fn(), setBubble: vi.fn() },
    weather: { dispose: vi.fn(), setActive: vi.fn(), update: vi.fn() }
  };
  const controller = createExplorationController(host, {
    context: () => ({ home: homeContext(), inputAvailable: true }),
    focus: () => ({ x: 16, z: 22 }),
    landmarks: () => [],
    rain: () => 0.45,
    spawn: { maxCandidates: 128, timeBudgetMs: 1_000 }
  });
  const advance = (milliseconds: number) => { nowValue += milliseconds; };
  const enter = () => controller.enter();
  const settleEntry = async (entry: ReturnType<typeof controller.enter>) => {
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.phase()).toBe("entering");
    advance(4_000);
    controller.update(0);
    await expect(entry).resolves.toEqual({ ok: true });
    expect(controller.phase()).toBe("possessed");
  };
  return { advance, boundary, controller, enter, settleEntry };
};

describe("exploration persistence boundary", { timeout: 60_000 }, () => {
  it("captures the ordinary RTS camera and no exploration fields in every phase", async () => {
    const harness = createHarness();
    const control = JSON.parse(JSON.stringify(captureRuntime(harness.boundary))) as GameRuntimeState;
    expectOrdinaryRtsCamera(control);

    const capture = () => JSON.parse(JSON.stringify(captureRuntime(harness.boundary))) as GameRuntimeState;
    expect(capture()).toEqual(control);

    const entry = harness.enter();
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.controller.phase()).toBe("entering");
    expect(harness.boundary.frame().camera).not.toBeNull();
    expect(capture(), "entering").toEqual(control);

    await harness.settleEntry(entry);
    harness.controller.setMovement(1, 0.4);
    harness.controller.setLook(0.3, -0.2);
    harness.controller.update(0.3);
    harness.controller.toggleSpyglass();
    harness.controller.update(0.2);
    expect(harness.boundary.frame().camera?.pose.mode).toBe("eye");
    expect(harness.boundary.frame().bubble).not.toBeNull();
    expect(harness.boundary.frame().appearance?.spyglass).toBe(true);
    expect(harness.boundary.frame().weather).not.toBeNull();
    expect(capture(), "possessed with a spyglass and a moving bubble").toEqual(control);
    expectOrdinaryRtsCamera(capture());

    harness.advance(2_100);
    harness.controller.requestLeave("leave");
    expect(harness.controller.phase()).toBe("returning");
    expect(capture(), "returning").toEqual(control);

    harness.advance(2_000);
    harness.controller.update(0);
    expect(harness.controller.phase()).toBe("dissipating");
    expect(capture(), "dissipating").toEqual(control);

    harness.advance(1_000);
    harness.controller.update(0);
    expect(harness.controller.phase()).toBe("cooldown");
    expect(capture(), "cooldown").toEqual(control);

    harness.controller.dispose();
    expect(harness.boundary.frame()).toMatchObject({
      appearance: null, bubble: null, camera: null, smoke: null, weather: null
    });
    expect(capture(), "after dispose").toEqual(control);
  });

  it("keeps the decoded GameSaveV1 runtime, camera, fog and settlement unchanged", async () => {
    const world = cachedWorld({ ...WORLD_OPTIONS, seed: 1234 });
    const simulation = createSettlementSimulation({ roads: createRoadNetwork(world), world });
    const settlement = simulation.saveState();
    const harness = createHarness();
    const controlRuntime = captureRuntime(harness.boundary);
    const controlSave = await createGameSave(
      world,
      settlement,
      { animals: [], name: "Home exploration persistence", savedAt: 123, source: "generated" },
      controlRuntime
    );
    const control = await readGameSave(JSON.parse(JSON.stringify(controlSave)));
    expectOrdinaryRtsCamera(control.runtime);
    expect(control.runtime).toEqual(controlRuntime);

    const decode = async (runtime: GameRuntimeState) => {
      const saved = await createGameSave(
        world,
        settlement,
        { animals: [], name: "Home exploration persistence", savedAt: 123, source: "generated" },
        runtime
      );
      return readGameSave(JSON.parse(JSON.stringify(saved)));
    };

    await harness.settleEntry(harness.enter());
    harness.controller.setMovement(1, 0.5);
    harness.controller.setLook(0.4, 0.1);
    harness.controller.update(0.4);
    harness.controller.toggleSpyglass();
    harness.controller.update(0.1);
    expect(harness.boundary.frame().smoke, "entry smoke is transient").toBeNull();
    expect(harness.boundary.frame().weather?.active).toBe(true);

    const possessed = await decode(captureRuntime(harness.boundary));
    expect(possessed.runtime).toEqual(controlRuntime);
    expectOrdinaryRtsCamera(possessed.runtime);
    expect(possessed.settlement).toEqual(control.settlement);
    expect(possessed.map.world.fog).toEqual(control.map.world.fog);
    expect(possessed.map.world.mineZones).toEqual(control.map.world.mineZones);

    harness.advance(2_100);
    harness.controller.requestLeave("leave");
    expect(harness.controller.phase()).toBe("returning");
    harness.advance(2_000);
    harness.controller.update(0);
    harness.advance(1_000);
    harness.controller.update(0);
    expect(harness.controller.phase()).toBe("cooldown");

    const cooled = await decode(captureRuntime(harness.boundary));
    expect(cooled.runtime).toEqual(controlRuntime);
    expectOrdinaryRtsCamera(cooled.runtime);
    expect(cooled.settlement).toEqual(control.settlement);
    expect(cooled.map.world.fog).toEqual(control.map.world.fog);

    // A real GameSaveV1 is decoded twice with identical authoritative content at every capture.
    const serializedRuntime = JSON.stringify(controlSave.runtime);
    expect(serializedRuntime).toContain('"camera"');
    for (const key of FORBIDDEN_RUNTIME_KEYS) expect(serializedRuntime).not.toContain(`"${key}"`);
  });

  it("does not let a transient frame leak through a JSON save-shaped decode", () => {
    const boundary = createExplorationCameraBoundary(RTS);
    const controlPayload = JSON.parse(JSON.stringify({
      format: "island-settlers-game",
      progress: { fog: [0, 1, 2], surveyed: [] },
      runtime: captureRuntime(boundary),
      savedAt: 123,
      settlement: { marker: "authoritative" },
      version: 1
    })) as Record<string, unknown>;
    const controlRuntime = controlPayload.runtime as GameRuntimeState;

    boundary.setPose({
      eyeHeight: 1.7, fov: 1.1, mode: "eye", pitch: -0.2, x: 2, y: 3, z: 4, yaw: 0.8
    }, 1);
    boundary.setBubble({ centerX: 2, centerZ: 4, radiusCells: 8, revision: 3 });
    boundary.setAppearance({
      pose: { eyeHeight: 1.7, fov: 1.1, mode: "eye", pitch: -0.2, x: 2, y: 3, z: 4, yaw: 0.8 },
      spyglass: true,
      visible: false
    });
    boundary.setSmoke({ kind: "arrival", progress: 0.5, x: 2, y: 3, z: 4 });
    boundary.setWeather({ active: true, cameraX: 2, cameraY: 2.7, cameraZ: 4, rain: 0.9 });

    const decoded = JSON.parse(JSON.stringify({
      format: "island-settlers-game",
      progress: { fog: [0, 1, 2], surveyed: [] },
      runtime: captureRuntime(boundary),
      savedAt: 123,
      settlement: { marker: "authoritative" },
      version: 1
    })) as Record<string, unknown>;
    expect(decoded).toEqual(controlPayload);
    expect(decoded.runtime).toEqual(controlRuntime);
    expect(forbiddenRuntimeKeys(decoded.runtime)).toEqual([]);
    expect(Object.keys((decoded.runtime as GameRuntimeState).camera)).toEqual([...RTS_CAMERA_FIELDS]);
  });
});

/**
 * These cases need the live boot and the 01G hook. They stay explicitly skipped instead of being
 * approximated with the pure boundary: native save/export/load, running-simulation goods and real
 * fog-source concurrency cannot be proven from a unit fixture.
 */
describe("live exploration save integration", () => {
  // The explicit skip is the deliverable until 01G: a fake live-boot pass would be evidence theatre.
  // oxlint-disable-next-line vitest/no-disabled-tests
  it.skip(`save/export/load during preparing, entering, possessed, returning, dissipating and cooldown — ${LIVE_HOOK_REASON}`, () => {
    // Activated after 01G: boot the fixed home save, drive window.__exploration through each phase,
    // call the live save coordinator, decode with readGameSave, and compare the complete payload
    // against a matched control that never entered exploration.
  });

  // oxlint-disable-next-line vitest/no-disabled-tests
  it.skip(`real fog sources, wildlife and a running simulation remain equal to control — ${LIVE_HOOK_REASON}`, () => {
    // Activated after 01G and EXPLORE-01E: move a real Scout and complete a staffed lookout while
    // the explorer bubble is visible; compare base fog, survey flags and authoritative state.
  });

  // oxlint-disable-next-line vitest/no-disabled-tests
  it.skip(`goods conservation through repeated native entry/exit cycles — ${LIVE_HOOK_REASON}`, () => {
    // Activated after 01G: the bench tool tools/bench/home-exploration-review.ts performs this
    // measurement with the fixed High/Minimal 256²/512² fixtures and a frozen simulation clock.
  });
});
