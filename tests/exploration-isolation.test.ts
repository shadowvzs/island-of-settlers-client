import { describe, expect, it, vi } from "vitest";

import {
  createExplorationCameraBoundary,
  type ExplorationAppearanceLease,
  type ExplorationCameraBoundary,
  type ExplorationGroundQuery,
  type ExplorationSessionIdentity,
  type ExplorationUiSnapshot,
  type HomeExplorationContext,
  snapshotRtsCamera
} from "../src/app/exploration/contracts";
import { createExplorationInputGate } from "../src/app/exploration/input/gate";
import {
  createExplorationController,
  type ExplorationRuntimeController
} from "../src/app/exploration/session";
import {
  createExplorationHudScope,
  EXPLORATION_HUD_ATTRIBUTE
} from "../src/app/exploration/ui/hud-scope";
import type { CameraState } from "../src/render-common/camera-state";
import type {
  ExplorationAppearanceFrame,
  ExplorationBubble,
  ExplorationSmokeFrame,
  ExplorationWeatherFrame
} from "../src/render-common/exploration/exploration-frame";

/**
 * EXPLORE-01H independent isolation evidence. The controller is exercised against deliberately
 * poisoned gameplay surfaces that it must never reach: a fake simulation, SaveStore, command
 * dispatcher, gameplay RNG and domain collections (actors, reservations, cargo, population).
 * Access is recorded through a host Proxy and every mutating method is a spy.
 *
 * These are not production-helper round trips: pass/fail depends on the absence of calls and
 * property reads on surfaces injected only by this test.
 */

const RTS: CameraState = {
  centerX: 15, centerZ: 21, tilt: 0.12, viewportHeight: 800, viewportWidth: 1280,
  yaw: 0.35, zoom: 1.4
};

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

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

interface Lease extends ExplorationAppearanceLease {
  dispose: ReturnType<typeof vi.fn<() => void>>;
  update: ReturnType<typeof vi.fn<(appearance: ExplorationAppearanceFrame | null) => void>>;
}

interface PendingAcquire {
  identity: ExplorationSessionIdentity;
  reject: (error: unknown) => void;
  resolve: (lease: ExplorationAppearanceLease) => void;
}

class FakeRoot {
  private readonly values = new Map<string, string>();
  removeCalls = 0;
  setCalls = 0;

  constructor(initial?: string) {
    if (initial !== undefined) this.values.set(EXPLORATION_HUD_ATTRIBUTE, initial);
  }

  getAttribute(name: string) {
    return this.values.get(name) ?? null;
  }

  removeAttribute(name: string) {
    this.removeCalls++;
    this.values.delete(name);
  }

  setAttribute(name: string, value: string) {
    this.setCalls++;
    this.values.set(name, value);
  }
}

const createGameplaySurfaces = () => {
  const actors = new Map<number, { job: string; uid: number }>([[1, { job: "Builder", uid: 1 }]]);
  const reservations = new Map<string, number>([["cell:4,7", 1]]);
  const cargo = { plank: 4, stone: 2 };
  const population = { idle: 1, settlers: 6, soldiers: 0 };
  const simulation = {
    addActor: vi.fn(() => 99),
    advance: vi.fn(),
    frames: vi.fn(() => []),
    saveState: vi.fn(() => ({ cargo, population })),
    update: vi.fn()
  };
  const saveStore = {
    flush: vi.fn(async () => true),
    readSavedGame: vi.fn(async () => null),
    writeSavedGame: vi.fn(async () => undefined),
    writeStartupGame: vi.fn(async () => undefined)
  };
  const commands = {
    dispatch: vi.fn(),
    enqueue: vi.fn(),
    record: vi.fn()
  };
  const rng = {
    chance: vi.fn(() => true),
    next: vi.fn(() => 0.5)
  };
  const domain = {
    actors,
    cargo,
    population,
    reservations,
    reserveCell: vi.fn(),
    spawn: vi.fn()
  };
  const surfaces = { commands, domain, rng, saveStore, simulation };
  const snapshot = () => ({
    actors: [...actors.entries()],
    cargo: { ...cargo },
    population: { ...population },
    reservations: [...reservations.entries()]
  });
  return { ...surfaces, snapshot, surfaces };
};

const createHarness = () => {
  let nowValue = 0;
  let context = homeContext();
  let inputAvailable = true;
  const groundFlags = { clear: true, owned: true, walkable: true, water: false };
  const identity: ExplorationSessionIdentity = {
    accountId: "account", generation: 1, islandKey: "home", slotId: "slot"
  };
  const acquisitions: PendingAcquire[] = [];
  const leases: Lease[] = [];
  const cameraCalls: string[] = [];
  const realBoundary = createExplorationCameraBoundary(RTS);
  const camera: ExplorationCameraBoundary = {
    clearTransient: () => {
      cameraCalls.push("clearTransient");
      realBoundary.clearTransient();
    },
    frame: realBoundary.frame,
    gameplayCamera: vi.fn(() => Object.freeze(realBoundary.gameplayCamera())),
    savedRts: vi.fn(() => Object.freeze(realBoundary.savedRts())),
    setAppearance: (appearance) => {
      cameraCalls.push(appearance ? `appearance:${appearance.visible}` : "appearance:null");
      realBoundary.setAppearance(appearance);
    },
    setBubble: (bubble) => {
      cameraCalls.push(bubble ? "bubble" : "bubble:null");
      realBoundary.setBubble(bubble);
    },
    setPose: (pose, blend = 1) => {
      cameraCalls.push(pose ? `pose:${blend}` : "pose:null");
      realBoundary.setPose(pose, blend);
    },
    setSmoke: (smoke) => {
      cameraCalls.push(smoke ? `smoke:${smoke.kind}` : "smoke:null");
      realBoundary.setSmoke(smoke);
    },
    setWeather: (weather) => {
      cameraCalls.push(weather ? "weather" : "weather:null");
      realBoundary.setWeather(weather);
    }
  };
  const appearance = {
    acquire: vi.fn((requested: ExplorationSessionIdentity) => new Promise<ExplorationAppearanceLease>(
      (resolve, reject) => {
        acquisitions.push({ identity: requested, reject, resolve });
      }
    ))
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
  const smokeBursts: { kind: "arrival" | "departure"; point: { x: number; y: number; z: number } }[] = [];
  const smokeUpdates: (ExplorationSmokeFrame | null)[] = [];
  const smoke = {
    burst: vi.fn((kind: "arrival" | "departure", point: { x: number; y: number; z: number }) => {
      smokeBursts.push({ kind, point: { ...point } });
    }),
    dispose: vi.fn(),
    update: vi.fn((frame: ExplorationSmokeFrame | null) => {
      smokeUpdates.push(frame ? { ...frame } : null);
    })
  };
  const uiSnapshots: ExplorationUiSnapshot[] = [];
  const hudRoot = new FakeRoot();
  const hudScope = createExplorationHudScope(hudRoot);
  const gate = createExplorationInputGate();
  const ui = {
    dispose: vi.fn(() => {
      hudScope.dispose();
      gate.dispose();
    }),
    publish: vi.fn((snapshot: ExplorationUiSnapshot) => {
      uiSnapshots.push(snapshot);
      hudScope.sync(snapshot.phase);
      gate.setPhase(snapshot.phase);
    })
  };
  const visibilityBubbles: (ExplorationBubble | null)[] = [];
  const visibility = {
    dispose: vi.fn(),
    setBubble: vi.fn((bubble: ExplorationBubble | null) => {
      visibilityBubbles.push(bubble ? { ...bubble } : null);
    })
  };
  const weatherActive: boolean[] = [];
  const weatherUpdates: (ExplorationWeatherFrame | null)[] = [];
  const weather = {
    dispose: vi.fn(),
    setActive: vi.fn((active: boolean) => { weatherActive.push(active); }),
    update: vi.fn((frame: ExplorationWeatherFrame | null) => {
      weatherUpdates.push(frame ? { ...frame } : null);
    })
  };
  const gameplay = createGameplaySurfaces();
  const gameplayAccesses: string[] = [];
  const gameplayKeys = new Set(Object.keys(gameplay.surfaces));
  const host = {
    appearance,
    camera,
    ground,
    identity: () => ({ ...identity }),
    now: () => nowValue,
    smoke,
    ui,
    visibility,
    weather,
    ...gameplay.surfaces
  };
  const guardedHost = new Proxy(host, {
    get(target, property, receiver) {
      if (typeof property === "string" && gameplayKeys.has(property)) gameplayAccesses.push(property);
      return Reflect.get(target, property, receiver);
    }
  });
  const controller: ExplorationRuntimeController = createExplorationController(guardedHost, {
    context: () => ({ home: { ...context }, inputAvailable }),
    focus: () => ({ x: 15, z: 21 }),
    landmarks: () => [],
    rain: () => 0.35,
    spawn: { maxCandidates: 128, timeBudgetMs: 1_000 }
  });
  const createLease = (): Lease => {
    const lease: Lease = {
      dispose: vi.fn<() => void>(),
      update: vi.fn<(appearance: ExplorationAppearanceFrame | null) => void>()
    };
    leases.push(lease);
    return lease;
  };
  const resolveNext = (lease = createLease()) => {
    const pending = acquisitions.shift();
    if (!pending) throw new Error("no pending appearance acquisition");
    pending.resolve(lease);
    return { identity: pending.identity, lease };
  };
  const advance = (milliseconds: number) => { nowValue += milliseconds; };
  const enterAndPossess = async () => {
    const entry = controller.enter();
    resolveNext();
    await flushPromises();
    expect(controller.phase()).toBe("entering");
    advance(4_000);
    controller.update(0);
    await expect(entry).resolves.toEqual({ ok: true });
    expect(controller.phase()).toBe("possessed");
  };
  return {
    acquisitions,
    advance,
    appearance,
    camera,
    cameraCalls,
    controller,
    createLease,
    enterAndPossess,
    gameplay,
    gameplayAccesses,
    gate,
    groundFlags,
    host: guardedHost,
    hudRoot,
    hudScope,
    identity,
    leases,
    resolveNext,
    setContext: (changes: Partial<HomeExplorationContext>) => { context = homeContext(changes); },
    setInputAvailable: (available: boolean) => { inputAvailable = available; },
    smoke,
    smokeBursts,
    smokeUpdates,
    ui,
    uiSnapshots,
    visibility,
    visibilityBubbles,
    weather,
    weatherActive,
    weatherUpdates
  };
};

/** The controller must not even read the poisoned gameplay keys. */
const expectNoGameplayAccess = (harness: ReturnType<typeof createHarness>, label: string) => {
  expect(harness.gameplayAccesses, label).toEqual([]);
  expect(harness.gameplay.simulation.update, label).not.toHaveBeenCalled();
  expect(harness.gameplay.simulation.addActor, label).not.toHaveBeenCalled();
  expect(harness.gameplay.simulation.saveState, label).not.toHaveBeenCalled();
  expect(harness.gameplay.saveStore.flush, label).not.toHaveBeenCalled();
  expect(harness.gameplay.saveStore.readSavedGame, label).not.toHaveBeenCalled();
  expect(harness.gameplay.saveStore.writeSavedGame, label).not.toHaveBeenCalled();
  expect(harness.gameplay.saveStore.writeStartupGame, label).not.toHaveBeenCalled();
  expect(harness.gameplay.commands.dispatch, label).not.toHaveBeenCalled();
  expect(harness.gameplay.commands.enqueue, label).not.toHaveBeenCalled();
  expect(harness.gameplay.commands.record, label).not.toHaveBeenCalled();
  expect(harness.gameplay.rng.next, label).not.toHaveBeenCalled();
  expect(harness.gameplay.rng.chance, label).not.toHaveBeenCalled();
  expect(harness.gameplay.domain.reserveCell, label).not.toHaveBeenCalled();
  expect(harness.gameplay.domain.spawn, label).not.toHaveBeenCalled();
};

describe("exploration economy, save and command isolation", () => {
  it("never reaches simulation, save, commands, RNG or domain collections", async () => {
    const harness = createHarness();
    const domainBefore = harness.gameplay.snapshot();
    const rtsBefore = snapshotRtsCamera(RTS);

    const expectClean = (label: string) => {
      expectNoGameplayAccess(harness, label);
      expect(harness.gameplay.snapshot(), label).toEqual(domainBefore);
      expect(snapshotRtsCamera(harness.camera.savedRts()), label).toEqual(rtsBefore);
      expect(snapshotRtsCamera(harness.camera.gameplayCamera()), label).toEqual(rtsBefore);
    };

    expectClean("idle");
    await harness.enterAndPossess();
    expectClean("after entry");

    const beforeMove = harness.controller.frame().camera!.pose;
    harness.controller.setMovement(1, 0.25);
    harness.controller.setLook(0.2, -0.1);
    harness.controller.update(0.25);
    const afterMove = harness.controller.frame().camera!.pose;
    expect(afterMove.z, "movement changes the presentation pose").not.toBe(beforeMove.z);
    expectClean("after movement and look");

    harness.controller.toggleSpyglass();
    harness.controller.update(0.25);
    expect(harness.controller.snapshot().spyglass).toBe(true);
    expectClean("after spyglass");

    harness.advance(2_100);
    harness.controller.requestLeave("leave");
    expect(harness.controller.phase()).toBe("returning");
    expectClean("after leave");

    harness.controller.update(0);
    harness.advance(2_000);
    harness.controller.update(0);
    expect(harness.controller.phase()).toBe("dissipating");
    expectClean("after returning");

    harness.advance(1_000);
    harness.controller.update(0);
    expect(harness.controller.phase()).toBe("cooldown");
    expectClean("after disappearance");

    harness.advance(3_000);
    harness.controller.update(0);
    expect(harness.controller.phase()).toBe("idle");
    expectClean("after cooldown");

    expect(harness.leases[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(harness.visibilityBubbles.at(-1)).toBeNull();
    expect(harness.weatherActive.at(-1)).toBe(false);
    expect(snapshotRtsCamera(RTS)).toEqual(rtsBefore);
  });

  it("releases appearance, smoke, visibility, weather and UI exactly once", async () => {
    const harness = createHarness();
    await harness.enterAndPossess();
    harness.controller.setMovement(1, 0);
    harness.controller.setLook(1, 0);
    harness.controller.toggleSpyglass();
    harness.controller.update(0.2);
    expectNoGameplayAccess(harness, "active session");

    harness.controller.forceExit("background");
    expect(harness.controller.phase()).toBe("idle");
    expect(harness.leases[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(harness.leases[0]?.update).toHaveBeenLastCalledWith(null);
    expect(harness.visibilityBubbles.at(-1)).toBeNull();
    expect(harness.weatherActive.at(-1)).toBe(false);
    expect(harness.weatherUpdates.at(-1)).toBeNull();
    expect(harness.smokeUpdates.at(-1)).toBeNull();
    expect(harness.hudScope.hidden()).toBe(false);
    expect(harness.hudScope.restoreCount()).toBe(1);
    expect(harness.gate.snapshot().suppressNormal).toBe(false);
    expect(harness.visibility.dispose, "adapter owners stay reusable after forced exit").not.toHaveBeenCalled();
    expect(harness.smoke.dispose, "smoke pool stays reusable after forced exit").not.toHaveBeenCalled();
    expect(harness.weather.dispose, "weather owner stays reusable after forced exit").not.toHaveBeenCalled();
    expect(harness.controller.snapshot().spyglass).toBe(false);
    expect(harness.controller.frame()).toMatchObject({
      appearance: null, bubble: null, camera: null, smoke: null, weather: null
    });

    harness.controller.forceExit("background");
    expect(harness.leases[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(harness.hudScope.restoreCount()).toBe(1);

    harness.controller.dispose();
    harness.controller.dispose();
    expect(harness.visibility.dispose).toHaveBeenCalledTimes(1);
    expect(harness.smoke.dispose).toHaveBeenCalledTimes(1);
    expect(harness.weather.dispose).toHaveBeenCalledTimes(1);
    expect(harness.ui.dispose).toHaveBeenCalledTimes(1);
    expect(harness.leases[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(harness.controller.phase()).toBe("disposed");
    expect(harness.controller.update(1)).toMatchObject({ revision: 0 });
    expect(harness.hudScope.hidden()).toBe(false);
    expectNoGameplayAccess(harness, "forced exit and dispose");

    // Disposing while active is the other forced-cleanup path: the HUD must restore there too.
    const active = createHarness();
    await active.enterAndPossess();
    expect(active.hudScope.hidden()).toBe(true);
    active.controller.dispose();
    expect(active.leases[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(active.hudScope.hidden()).toBe(false);
    expect(active.hudScope.restoreCount()).toBe(1);
    expect(active.visibility.dispose).toHaveBeenCalledTimes(1);
    expect(active.visibilityBubbles.at(-1)).toBeNull();
    expect(active.smoke.dispose).toHaveBeenCalledTimes(1);
    expect(active.weather.dispose).toHaveBeenCalledTimes(1);
    expect(active.ui.dispose).toHaveBeenCalledTimes(1);
    expectNoGameplayAccess(active, "disposed active session");
  });

  it("releases stale async generations instead of installing them", async () => {
    const stale = createHarness();
    const entry = stale.controller.enter();
    stale.identity.generation = 2;
    stale.resolveNext();
    await flushPromises();
    await expect(entry).resolves.toEqual({ ok: false, reason: "stale" });
    expect(stale.leases[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(stale.leases[0]?.update).toHaveBeenCalledWith(null);
    expect(stale.cameraCalls.filter(call => call.startsWith("appearance"))).toEqual([]);
    expect(stale.controller.phase()).toBe("idle");
    expect(stale.controller.frame().camera).toBeNull();
    expect(stale.hudScope.hidden()).toBe(false);
    expectNoGameplayAccess(stale, "stale generation");

    const forced = createHarness();
    const forcedEntry = forced.controller.enter();
    forced.controller.forceExit("session-replacement");
    const lateLease = forced.createLease();
    forced.resolveNext(lateLease);
    await flushPromises();
    await expect(forcedEntry).resolves.toEqual({ ok: false, reason: "cancelled" });
    expect(lateLease.dispose).toHaveBeenCalledTimes(1);
    expect(forced.cameraCalls.filter(call => call.startsWith("appearance"))).toEqual([]);
    expect(forced.controller.phase()).toBe("idle");
    expect(forced.controller.frame().camera).toBeNull();
    expect(forced.hudScope.hidden()).toBe(false);
    expectNoGameplayAccess(forced, "forced exit during preparation");
  });

  it("keeps the normal HUD scope and input gate in step with the real controller", async () => {
    const harness = createHarness();
    await harness.enterAndPossess();
    expect(harness.hudScope.hidden()).toBe(true);
    expect(harness.gate.snapshot()).toMatchObject({
      entryReady: false,
      leave: true,
      look: true,
      move: true,
      spyglass: true,
      suppressNormal: true
    });
    expect(harness.gate.hooks.hoverAllowed()).toBe(false);
    expect(harness.gate.hooks.pickingAllowed()).toBe(false);
    expect(harness.gate.hooks.shortcutAllowed()).toBe(false);
    expect(harness.gate.hooks.beginPointer(1, "mouse")).toBe(false);

    const startZ = harness.controller.frame().camera!.pose.z;
    harness.controller.setMovement(1, 0);
    harness.controller.setLook(0, 0);
    harness.controller.update(0.25);
    expect(harness.controller.frame().camera!.pose.z).toBeGreaterThan(startZ);
    harness.controller.toggleSpyglass();
    expect(harness.controller.snapshot().spyglass).toBe(true);

    harness.controller.clearInputs();
    const clearedZ = harness.controller.frame().camera!.pose.z;
    harness.controller.update(0.5);
    expect(harness.controller.frame().camera!.pose.z, "held movement is cleared").toBe(clearedZ);
    expect(harness.controller.snapshot().spyglass, "clearInputs only clears held movement").toBe(true);

    harness.controller.requestLeave("leave", true);
    expect(harness.controller.phase()).toBe("returning");
    expect(harness.hudScope.hidden(), "HUD stays hidden through the return").toBe(true);
    expect(harness.gate.snapshot()).toMatchObject({
      leave: true,
      look: false,
      move: false,
      spyglass: false,
      suppressNormal: true
    });
    expect(harness.controller.snapshot().spyglass).toBe(false);

    harness.controller.update(0);
    harness.advance(2_000);
    harness.controller.update(0);
    expect(harness.controller.phase()).toBe("dissipating");
    expect(harness.hudScope.hidden()).toBe(true);

    harness.advance(1_000);
    harness.controller.update(0);
    expect(harness.controller.phase()).toBe("cooldown");
    expect(harness.hudScope.hidden()).toBe(false);
    expect(harness.hudScope.restoreCount()).toBe(1);
    expect(harness.gate.snapshot()).toMatchObject({
      entryReady: false,
      look: false,
      move: false,
      suppressNormal: false
    });
    expect(harness.gate.hooks.hoverAllowed()).toBe(true);
    expect(harness.gate.hooks.pickingAllowed()).toBe(true);
    expect(harness.gate.hooks.shortcutAllowed()).toBe(true);

    harness.advance(3_000);
    harness.controller.update(0);
    expect(harness.controller.phase()).toBe("idle");
    expect(harness.gate.snapshot().entryReady).toBe(true);
    expect(harness.hudScope.hidden()).toBe(false);
    expect(harness.hudScope.restoreCount()).toBe(1);
    harness.controller.dispose();
    expect(harness.hudScope.restoreCount(), "dispose does not restore twice").toBe(1);
    expectNoGameplayAccess(harness, "HUD/input lifecycle");
  });

  it("refuses ineligible, busy or unsafe entry without touching any owner", async () => {
    const harness = createHarness();
    harness.setContext({ homeIsland: false });
    await expect(harness.controller.enter()).resolves.toEqual({ ok: false, reason: "not-home" });

    harness.setContext({});
    harness.setInputAvailable(false);
    await expect(harness.controller.enter()).resolves.toEqual({ ok: false, reason: "input-busy" });

    harness.setInputAvailable(true);
    harness.groundFlags.walkable = false;
    await expect(harness.controller.enter()).resolves.toEqual({ ok: false, reason: "no-safe-spawn" });

    expect(harness.appearance.acquire).not.toHaveBeenCalled();
    expect(harness.leases).toHaveLength(0);
    expect(harness.hudScope.hidden()).toBe(false);
    expectNoGameplayAccess(harness, "refused entry");
    expect(harness.controller.frame()).toMatchObject({ revision: 0 });
  });
});
