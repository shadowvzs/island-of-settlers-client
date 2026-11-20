import { describe, expect, it, type Mock, vi } from "vitest";

import {
  createExplorationCameraBoundary,
  type ExplorationAppearanceLease,
  type ExplorationCameraBoundary,
  type ExplorationGroundQuery,
  type ExplorationHost,
  type ExplorationSessionIdentity,
  type ExplorationUiSnapshot,
  type HomeExplorationContext,
  rtsCameraEquals,
  snapshotRtsCamera
} from "../src/app/exploration/contracts";
import { EXPLORATION_VIEW_DISTANCE } from "../src/app/exploration/movement";
import {
  createExplorationController,
  type ExplorationRuntimeController
} from "../src/app/exploration/session";
import type { CameraState } from "../src/render-common/camera-state";
import type {
  ExplorationAppearanceFrame,
  ExplorationBubble,
  ExplorationSmokeFrame,
  ExplorationWeatherFrame
} from "../src/render-common/exploration/exploration-frame";

const RTS: CameraState = {
  centerX: 12, centerZ: 12, tilt: 0.08, viewportHeight: 720, viewportWidth: 1280,
  yaw: 0, zoom: 1.25
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
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

interface Lease extends ExplorationAppearanceLease {
  dispose: Mock<() => void>;
  update: Mock<(appearance: ExplorationAppearanceFrame | null) => void>;
}

interface PendingAcquire {
  identity: ExplorationSessionIdentity;
  reject: (error: unknown) => void;
  resolve: (lease: ExplorationAppearanceLease) => void;
}

const createHarness = (entryStarting?: () => void, actorType?: () => unknown) => {
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
  const baseCamera = createExplorationCameraBoundary(RTS);
  const camera: ExplorationCameraBoundary = {
    ...baseCamera,
    clearTransient: () => { cameraCalls.push("clear"); baseCamera.clearTransient(); },
    setAppearance: (appearance: ExplorationAppearanceFrame | null) => {
      cameraCalls.push(appearance ? `appearance:${appearance.visible}` : "appearance:null");
      baseCamera.setAppearance(appearance);
    },
    setBubble: (bubble: ExplorationBubble | null) => {
      cameraCalls.push(bubble ? "bubble" : "bubble:null");
      baseCamera.setBubble(bubble);
    },
    setPose: (pose, blend = 1) => {
      cameraCalls.push(pose ? `pose:${blend}` : "pose:null");
      baseCamera.setPose(pose, blend);
    },
    setSmoke: (smoke: ExplorationSmokeFrame | null) => {
      cameraCalls.push(smoke ? `smoke:${smoke.kind}` : "smoke:null");
      baseCamera.setSmoke(smoke);
    },
    setWeather: (weather: ExplorationWeatherFrame | null) => {
      cameraCalls.push(weather ? "weather" : "weather:null");
      baseCamera.setWeather(weather);
    }
  };
  const appearance = {
    acquire: vi.fn((requested: ExplorationSessionIdentity) => new Promise<ExplorationAppearanceLease>(
      (resolve, reject) => { acquisitions.push({ identity: requested, reject, resolve }); }
    ))
  };
  const ground: ExplorationGroundQuery = {
    cellsX: 24,
    cellsZ: 24,
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
  const ui = {
    dispose: vi.fn(),
    publish: vi.fn((snapshot: ExplorationUiSnapshot) => uiSnapshots.push(snapshot))
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
  const host: ExplorationHost = {
    appearance,
    camera,
    ground,
    identity: () => ({ ...identity }),
    now: () => nowValue,
    smoke,
    ui,
    visibility,
    weather
  };
  const controller: ExplorationRuntimeController = createExplorationController(host, {
    actorType,
    context: () => ({ home: { ...context }, inputAvailable }),
    focus: () => ({ x: 12, z: 12 }),
    landmarks: () => [],
    onEntryStarting: entryStarting,
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
  const rejectNext = (error: unknown = new Error("asset failure")) => {
    const pending = acquisitions.shift();
    if (!pending) throw new Error("no pending appearance acquisition");
    pending.reject(error);
  };
  return {
    acquisitions,
    advance: (milliseconds: number) => { nowValue += milliseconds; },
    appearance,
    camera,
    cameraCalls,
    controller,
    createLease,
    groundFlags,
    host,
    identity,
    leases,
    now: () => nowValue,
    rejectNext,
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

const enterAndPossess = async (harness: ReturnType<typeof createHarness>) => {
  const entry = harness.controller.enter();
  harness.resolveNext();
  await flushPromises();
  expect(harness.controller.phase()).toBe("entering");
  harness.advance(4_000);
  harness.controller.update(0);
  await expect(entry).resolves.toEqual({ ok: true });
  expect(harness.controller.phase()).toBe("possessed");
};

describe("temporary possessed jump", () => {
  it.each(["Soldier", "shield", "heavy", "archer", "cavalry", "commander", "unknown"])(
    "denies jump and spyglass direct calls for capability identity %s without adding unit possession", async actorType => {
      const h = createHarness(undefined, () => actorType); await enterAndPossess(h);
      expect(h.controller.snapshot().actorType).toBe(actorType);
      expect(h.controller.jump()).toBe(false);
      h.controller.toggleSpyglass(); h.controller.adjustSpyglassZoom(1);
      expect(h.controller.frame().appearance!.spyglass).toBe(false);
      expect(h.controller.snapshot().spyglassZoom).toBe(3);
      // The ordinary military capability still permits walking; jump is an independent denial.
      const z = h.controller.frame().camera!.pose.z;
      h.controller.setMovement(1, 0); h.controller.update(.1);
      expect(h.controller.frame().camera!.pose.z > z).toBe(actorType !== "unknown");
      h.controller.forceExit("session-replacement"); expect(h.controller.frame().appearance).toBeNull();
    });

  it("clears held movement/look and raised spyglass on unknown capability, and denies zoom before sanitization", async () => {
    let actorType = "Scout";
    const h = createHarness(undefined, () => actorType); await enterAndPossess(h);
    h.controller.setMovement(1, 0); h.controller.setLook(1, .2); h.controller.toggleSpyglass();
    expect(h.controller.frame().appearance!.spyglass).toBe(true);
    const before = { ...h.controller.frame().camera!.pose };
    actorType = "unknown";
    h.controller.adjustSpyglassZoom(1); expect(h.controller.snapshot().spyglassZoom).toBe(3);
    h.controller.update(.1);
    const after = h.controller.frame().camera!.pose;
    expect([after.x, after.z, after.yaw, after.pitch]).toEqual([before.x, before.z, before.yaw, before.pitch]);
    expect(h.controller.frame().appearance!.spyglass).toBe(false);
    expect(h.controller.snapshot().actorType).toBe("unknown");
  });

  it("discards the temporary airborne body if its identity changes to a grounded military capability", async () => {
    let actorType = "Scout";
    const h = createHarness(undefined, () => actorType); await enterAndPossess(h);
    h.controller.jump(); h.controller.update(.25);
    expect(h.controller.frame().appearance!.feetY).toBeGreaterThan(.1);
    actorType = "commander"; h.controller.update(.01);
    expect(h.controller.phase()).toBe("idle"); expect(h.controller.frame().appearance).toBeNull();
    await enterAndPossess(h); expect(h.controller.jump()).toBe(false);
  });
  it("adds no idle ceiling work, follows physical feet with eye/weather and rejects double jumps", async () => {
    const h = createHarness(); await enterAndPossess(h);
    const ceiling = vi.fn(() => Infinity); h.host.ground.ceilingHeight = ceiling;
    for (let tick = 0; tick < 100; tick++) { h.advance(10); h.controller.update(.01); }
    expect(ceiling).not.toHaveBeenCalled();
    expect(h.controller.jump()).toBe(true); expect(h.controller.jump()).toBe(false);
    let peak = 0;
    for (let tick = 0; tick < 100; tick++) {
      h.advance(10); const frame = h.controller.update(.01);
      peak = Math.max(peak, frame.appearance?.feetY ?? 0);
      expect(frame.weather!.cameraY).toBeCloseTo(frame.camera!.pose.y);
      expect(frame.appearance!.visible).toBe(false);
    }
    expect(peak).toBeGreaterThan(.49); expect(peak).toBeLessThanOrEqual(.501);
    expect(h.controller.frame().appearance!.jump).toBeUndefined();
    const queries = ceiling.mock.calls.length;
    for (let tick = 0; tick < 100; tick++) { h.advance(10); h.controller.update(.01); }
    expect(ceiling).toHaveBeenCalledTimes(queries);
    expect(h.controller.jump()).toBe(true);
    h.controller.forceExit("session-replacement");
    expect(h.controller.frame().appearance).toBeNull(); expect(h.controller.jump()).toBe(false);
  });

  it("keeps the head below a low beam and blocks airborne entry into a lower canopy", async () => {
    const h = createHarness(); await enterAndPossess(h);
    h.host.ground.ceilingHeight = () => 1.2;
    expect(h.controller.jump()).toBe(true);
    let peak = 0;
    for (let tick = 0; tick < 80; tick++) { h.advance(10); peak = Math.max(peak,
      h.controller.update(.01).appearance?.feetY ?? 0); }
    expect(peak).toBeLessThanOrEqual(1.2 - 1.0625 - .015 + 1e-9);
    const z = h.controller.frame().camera!.pose.z;
    h.host.ground.ceilingHeight = (_x, nextZ) => nextZ > z + .2 ? 1.2 : Infinity;
    expect(h.controller.jump()).toBe(true);
    for (let tick = 0; tick < 30; tick++) { h.advance(10); h.controller.update(.01); }
    h.controller.setMovement(1, 0); h.advance(100); h.controller.update(.1);
    expect(h.controller.frame().camera!.pose.z).toBe(z);
    h.controller.dispose(); expect(h.controller.frame().appearance).toBeNull();
  });

  it("lands naturally during ordinary leave and discards midair state on technical exit", async () => {
    const h = createHarness(); await enterAndPossess(h);
    h.controller.jump();
    for (let tick = 0; tick < 30; tick++) { h.advance(10); h.controller.update(.01); }
    const before = h.controller.frame().camera!.pose.y;
    h.controller.requestLeave("leave", true);
    expect(h.controller.phase()).toBe("returning");
    expect(h.controller.frame().camera!.pose.y).toBeCloseTo(before);
    for (let tick = 0; tick < 100; tick++) { h.advance(10); h.controller.update(.01); }
    expect(h.controller.frame().appearance!.jump).toBeUndefined();
    expect(h.controller.frame().camera!.pose.y).toBeLessThan(before);
    h.controller.forceExit("background"); expect(h.controller.frame().appearance).toBeNull();
    expect(h.controller.jump()).toBe(false);
  });
});

describe("CIN3 suspended possession", () => {
  it("freezes the body, lowers the spyglass for good and resumes without a leave or lockout", async () => {
    const h = createHarness(); await enterAndPossess(h);
    h.controller.toggleSpyglass();
    h.controller.setMovement(1, 0);
    h.controller.setSuspended(true);
    expect(h.controller.suspended()).toBe(true);
    expect(h.controller.frame().appearance!.spyglass).toBe(false);
    expect(h.controller.frame().appearance!.visible).toBe(true);
    const before = { ...h.controller.frame().camera!.pose };
    h.controller.setMovement(1, 0); h.controller.setLook(1, .2); h.controller.escape(); h.controller.toggleSpyglass();
    expect(h.controller.jump()).toBe(false);
    h.advance(10_000); h.controller.update(.5);
    const after = h.controller.frame().camera!.pose;
    expect([after.x, after.z, after.yaw, after.pitch]).toEqual([before.x, before.z, before.yaw, before.pitch]);
    expect(h.controller.phase()).toBe("possessed");
    h.controller.setSuspended(false);
    expect(h.controller.phase()).toBe("possessed");
    expect(h.controller.snapshot().spyglass).toBe(false);
    expect(h.controller.snapshot().leaveUnlockInMs).toBe(0);
    expect(h.controller.frame().appearance!.visible).toBe(false);
    h.controller.setMovement(1, 0); h.controller.update(.1);
    expect(h.controller.frame().camera!.pose.z).not.toBe(before.z);
  });
});

describe("exploration session", () => {
  it("orders entry, dwell, leave, return, disappearance and cooldown without touching the RTS camera", async () => {
    const harness = createHarness();
    const saved = snapshotRtsCamera(RTS);
    expect(harness.controller.snapshot()).toMatchObject({
      canEnter: true, cooldownInMs: 0, leaveUnlockInMs: 0, phase: "idle", spyglass: false
    });
    const entry = harness.controller.enter();
    expect(harness.appearance.acquire).toHaveBeenCalledTimes(1);
    expect(harness.acquisitions[0]?.identity).toEqual(harness.identity);
    harness.resolveNext();
    await flushPromises();
    expect(harness.controller.phase()).toBe("entering");
    expect(harness.controller.frame().camera).toMatchObject({
      blend: 0, pose: { mode: "transition", x: 12, z: 12 }
    });
    expect(harness.smokeBursts[0]).toMatchObject({ kind: "arrival", point: { x: 12, z: 12 } });
    expect(harness.weatherActive).toContain(true);
    expect(harness.controller.snapshot().progress).toBe(0);

    harness.advance(2_000);
    harness.controller.update(0);
    expect(harness.controller.snapshot().progress).toBeCloseTo(0.5);

    harness.advance(2_000);
    harness.controller.update(0);
    await expect(entry).resolves.toEqual({ ok: true });
    expect(harness.controller.phase()).toBe("possessed");
    expect(harness.controller.snapshot().leaveUnlockInMs).toBe(2_000);
    expect(harness.controller.frame()).toMatchObject({
      appearance: { spyglass: false, visible: false },
      bubble: { radiusCells: 8 },
      camera: { blend: 1, pose: { mode: "eye" } }
    });
    expect(harness.visibilityBubbles.at(-1)).toMatchObject({ radiusCells: 8 });
    expect(rtsCameraEquals(harness.camera.savedRts(), harness.camera.gameplayCamera())).toBe(true);
    expect(snapshotRtsCamera(harness.camera.savedRts())).toEqual(saved);

    harness.advance(500);
    harness.controller.requestLeave("leave");
    expect(harness.controller.phase()).toBe("possessed");
    expect(harness.controller.snapshot().notice).toBe("Leave unlocks shortly.");

    harness.advance(1_500);
    harness.controller.requestLeave("leave");
    expect(harness.controller.phase()).toBe("returning");
    expect(harness.controller.snapshot()).toMatchObject({
      leaveUnlockInMs: 0, phase: "returning", spyglass: false
    });
    expect(harness.controller.frame()).toMatchObject({
      appearance: { visible: true }, bubble: null,
      camera: { blend: 1, pose: { mode: "transition" } }
    });
    expect(harness.visibilityBubbles.at(-1)).toBeNull();

    harness.advance(1_999);
    harness.controller.update(0);
    expect(harness.controller.phase()).toBe("returning");
    harness.advance(1);
    harness.controller.update(0);
    expect(harness.controller.phase()).toBe("dissipating");
    expect(harness.smokeBursts.map(burst => burst.kind)).toEqual(["arrival", "departure"]);
    expect(harness.controller.frame().camera).toBeNull();
    expect(harness.controller.frame().smoke).toMatchObject({ kind: "departure", progress: 0 });

    harness.advance(500);
    harness.controller.update(0);
    expect(harness.controller.frame().smoke?.progress).toBeCloseTo(0.5);
    harness.advance(500);
    harness.controller.update(0);
    expect(harness.controller.phase()).toBe("cooldown");
    expect(harness.leases[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(harness.controller.frame()).toMatchObject({
      appearance: null, bubble: null, camera: null, smoke: null, weather: null
    });
    expect(harness.weatherActive.at(-1)).toBe(false);
    expect(harness.controller.snapshot()).toMatchObject({ canEnter: false, cooldownInMs: 3_000 });

    const denied = harness.controller.enter();
    await expect(denied).resolves.toEqual({ ok: false, reason: "cooldown" });
    expect(harness.appearance.acquire).toHaveBeenCalledTimes(1);

    harness.advance(2_999);
    harness.controller.update(0);
    expect(harness.controller.phase()).toBe("cooldown");
    harness.advance(1);
    harness.controller.update(0);
    expect(harness.controller.phase()).toBe("idle");
    expect(harness.controller.snapshot()).toMatchObject({ canEnter: true, cooldownInMs: 0 });
    const phases = harness.uiSnapshots.map(snapshot => snapshot.phase)
      .filter((phase, index, all) => index === 0 || phase !== all[index - 1]);
    expect(phases).toEqual([
      "idle", "preparing", "entering", "possessed", "returning", "dissipating", "cooldown", "idle"
    ]);
    expect(rtsCameraEquals(harness.camera.savedRts(), harness.camera.gameplayCamera())).toBe(true);
    expect(snapshotRtsCamera(harness.camera.savedRts())).toEqual(saved);
  });

  it("coalesces repeated entry taps and refuses a second body", async () => {
    const harness = createHarness();
    const first = harness.controller.enter();
    const repeated = harness.controller.enter();
    expect(repeated).toBe(first);
    expect(harness.appearance.acquire).toHaveBeenCalledTimes(1);
    harness.resolveNext();
    await flushPromises();
    const whileEntering = harness.controller.enter();
    await expect(whileEntering).resolves.toEqual({ ok: false, reason: "busy" });
    expect(harness.appearance.acquire).toHaveBeenCalledTimes(1);
    harness.advance(4_000);
    harness.controller.update(0);
    await expect(first).resolves.toEqual({ ok: true });
    const whilePossessed = harness.controller.enter();
    await expect(whilePossessed).resolves.toEqual({ ok: false, reason: "already-active" });
    expect(harness.appearance.acquire).toHaveBeenCalledTimes(1);
    expect(harness.leases).toHaveLength(1);
  });

  it("refuses ineligible, busy-input, blocked-spawn and active-gesture entries", async () => {
    const harness = createHarness();
    harness.setContext({ homeIsland: false });
    await expect(harness.controller.enter()).resolves.toEqual({ ok: false, reason: "not-home" });
    expect(harness.appearance.acquire).not.toHaveBeenCalled();

    harness.setContext({});
    harness.setInputAvailable(false);
    await expect(harness.controller.enter()).resolves.toEqual({ ok: false, reason: "input-busy" });
    expect(harness.appearance.acquire).not.toHaveBeenCalled();

    harness.setInputAvailable(true);
    harness.groundFlags.walkable = false;
    await expect(harness.controller.enter()).resolves.toEqual({ ok: false, reason: "no-safe-spawn" });
    expect(harness.appearance.acquire).not.toHaveBeenCalled();

    harness.groundFlags.walkable = true;
    harness.setContext({ editor: true });
    await expect(harness.controller.enter()).resolves.toEqual({ ok: false, reason: "editor" });
  });

  it("releases a stale async appearance and a late-invalidated spawn", async () => {
    const stale = createHarness();
    const staleEntry = stale.controller.enter();
    stale.identity.generation = 2;
    stale.resolveNext();
    await flushPromises();
    await expect(staleEntry).resolves.toEqual({ ok: false, reason: "stale" });
    expect(stale.leases[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(stale.controller.phase()).toBe("idle");
    expect(stale.controller.frame().camera).toBeNull();

    const late = createHarness();
    const lateEntry = late.controller.enter();
    late.groundFlags.clear = false;
    late.resolveNext();
    await flushPromises();
    await expect(lateEntry).resolves.toEqual({ ok: false, reason: "no-safe-spawn" });
    expect(late.leases[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(late.controller.phase()).toBe("idle");
    expect(late.controller.frame().camera).toBeNull();
  });

  it("rechecks eligibility before installing a resolved appearance", async () => {
    const harness = createHarness();
    const entry = harness.controller.enter();
    harness.setContext({ homeIsland: false });
    harness.resolveNext();
    await flushPromises();
    await expect(entry).resolves.toEqual({ ok: false, reason: "not-home" });
    expect(harness.leases[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(harness.controller.phase()).toBe("idle");
  });

  it("refuses cleanly and logs the real appearance preparation error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const harness = createHarness();
    const entry = harness.controller.enter();
    harness.rejectNext(new Error("asset failed"));
    await flushPromises();
    await expect(entry).resolves.toEqual({ ok: false, reason: "appearance-failed" });
    expect(warn).toHaveBeenCalledWith(
      "Exploration appearance could not be prepared",
      expect.objectContaining({ message: "asset failed" })
    );
    expect(harness.controller.phase()).toBe("idle");
    expect(harness.controller.frame().camera).toBeNull();
    expect(harness.leases).toHaveLength(0);
    warn.mockRestore();
  });

  it("cancels a forced leave during entry and still runs the ordered exit", async () => {
    const harness = createHarness();
    const entry = harness.controller.enter();
    harness.resolveNext();
    await flushPromises();
    expect(harness.controller.phase()).toBe("entering");
    harness.advance(1_000);
    harness.controller.requestLeave("leave", true);
    await expect(entry).resolves.toEqual({ ok: false, reason: "cancelled" });
    expect(harness.controller.phase()).toBe("returning");
    harness.advance(2_000);
    harness.controller.update(0);
    expect(harness.controller.phase()).toBe("dissipating");
    harness.advance(1_000);
    harness.controller.update(0);
    expect(harness.controller.phase()).toBe("cooldown");
    expect(harness.leases[0]?.dispose).toHaveBeenCalledTimes(1);
    harness.advance(3_000);
    harness.controller.update(0);
    expect(harness.controller.phase()).toBe("idle");
  });

  it("releases a stale lease when forceExit wins a pending preparation", async () => {
    const harness = createHarness();
    const entry = harness.controller.enter();
    harness.controller.forceExit("background");
    await expect(entry).resolves.toEqual({ ok: false, reason: "cancelled" });
    const lease = harness.createLease();
    harness.resolveNext(lease);
    await flushPromises();
    expect(lease.dispose).toHaveBeenCalledTimes(1);
    expect(harness.controller.phase()).toBe("idle");
  });

  it("adjusts spyglass zoom in exact tenths within 2× and 8×", async () => {
    const harness = createHarness();
    await enterAndPossess(harness);
    harness.controller.toggleSpyglass();
    harness.controller.adjustSpyglassZoom(1);
    expect(harness.controller.snapshot().spyglassZoom).toBe(3.1);
    for (let step = 0; step < 100; step++) harness.controller.adjustSpyglassZoom(1);
    expect(harness.controller.snapshot().spyglassZoom).toBe(8);
    harness.controller.adjustSpyglassZoom(-1);
    expect(harness.controller.snapshot().spyglassZoom).toBe(7.9);
    for (let step = 0; step < 100; step++) harness.controller.adjustSpyglassZoom(-1);
    expect(harness.controller.snapshot().spyglassZoom).toBe(2);
  });

  it("forceExit stops inputs, clears transient state and releases exactly once", async () => {
    const harness = createHarness();
    await enterAndPossess(harness);
    harness.controller.setMovement(1, 1);
    harness.controller.setLook(1, 1);
    harness.controller.toggleSpyglass();
    expect(harness.controller.snapshot().spyglass).toBe(true);

    harness.controller.forceExit("background");
    expect(harness.controller.phase()).toBe("idle");
    expect(harness.leases[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(harness.controller.snapshot().spyglass).toBe(false);
    expect(harness.visibilityBubbles.at(-1)).toBeNull();
    expect(harness.weatherActive.at(-1)).toBe(false);
    expect(harness.controller.frame()).toMatchObject({
      appearance: null, bubble: null, camera: null, smoke: null, weather: null
    });
    harness.controller.forceExit("background");
    expect(harness.leases[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(harness.visibility.dispose).not.toHaveBeenCalled();

    harness.controller.dispose();
    harness.controller.dispose();
    expect(harness.visibility.dispose).toHaveBeenCalledTimes(1);
    expect(harness.smoke.dispose).toHaveBeenCalledTimes(1);
    expect(harness.weather.dispose).toHaveBeenCalledTimes(1);
    expect(harness.ui.dispose).toHaveBeenCalledTimes(1);
    expect(harness.controller.snapshot().phase).toBe("disposed");
    expect(harness.controller.frame()).toMatchObject({ revision: 0 });
    expect(harness.controller.update(1)).toMatchObject({ revision: 0 });
    await expect(harness.controller.enter()).resolves.toEqual({ ok: false, reason: "disposed" });
  });

  it("cancels pending preparation on dispose and still releases the late lease once", async () => {
    const harness = createHarness();
    const entry = harness.controller.enter();
    expect(harness.acquisitions).toHaveLength(1);
    harness.controller.dispose();
    await expect(entry).resolves.toEqual({ ok: false, reason: "cancelled" });
    expect(harness.visibility.dispose).toHaveBeenCalledTimes(1);
    const lateLease = harness.createLease();
    harness.resolveNext(lateLease);
    await flushPromises();
    expect(lateLease.dispose).toHaveBeenCalledTimes(1);
    expect(harness.controller.phase()).toBe("disposed");
  });

  it("enforces the minimum dwell and clears held movement and spyglass on leave", async () => {
    const harness = createHarness();
    await enterAndPossess(harness);
    expect(harness.controller.frame().camera?.pose.mode).toBe("eye");
    const start = harness.controller.frame().camera!.pose;
    harness.controller.setMovement(1, 0);
    harness.controller.setLook(0, 0);
    harness.controller.update(0.1);
    const moved = harness.controller.frame().camera!.pose;
    expect(moved.z).toBeGreaterThan(start.z);

    harness.controller.toggleSpyglass();
    expect(harness.controller.frame().appearance?.spyglass).toBe(true);
    harness.controller.clearInputs();
    expect(harness.controller.snapshot().spyglass).toBe(true);
    harness.advance(500);
    harness.controller.requestLeave("leave");
    expect(harness.controller.phase()).toBe("possessed");
    expect(harness.controller.snapshot().notice).toBe("Leave unlocks shortly.");
    harness.advance(1_500);
    harness.controller.update(0);
    expect(harness.controller.snapshot().notice).toBeUndefined();
    harness.controller.requestLeave("leave");
    expect(harness.controller.phase()).toBe("returning");
    expect(harness.controller.frame().appearance?.spyglass).toBe(false);
    const beforeReturnMove = harness.controller.frame().camera!.pose;
    harness.controller.setMovement(1, 0);
    harness.controller.update(1);
    expect(harness.controller.frame().camera!.pose.z).toBe(beforeReturnMove.z);
    harness.controller.requestLeave("leave");
    expect(harness.controller.phase()).toBe("returning");
  });

  it("closes an active spyglass on Escape, then the same key leaves possession", async () => {
    const harness = createHarness();
    await enterAndPossess(harness);
    harness.controller.toggleSpyglass();
    expect(harness.controller.snapshot().spyglass).toBe(true);
    expect(harness.controller.frame().appearance?.spyglass).toBe(true);
    harness.controller.escape();
    expect(harness.controller.snapshot().spyglass).toBe(false);
    expect(harness.controller.frame().appearance?.spyglass).toBe(false);
    expect(harness.controller.phase()).toBe("possessed");
    harness.advance(2_100);
    harness.controller.escape();
    expect(harness.controller.phase()).toBe("returning");
    expect(harness.controller.snapshot().spyglass).toBe(false);
  });

  it("shortens the eye sight line in rain without losing the near scene", async () => {
    const harness = createHarness();
    await enterAndPossess(harness);
    const pose = harness.controller.frame().camera!.pose;
    expect(pose.viewDistance).toBeLessThan(EXPLORATION_VIEW_DISTANCE);
    expect(pose.viewDistance ?? 0).toBeGreaterThan(80);
    harness.controller.toggleSpyglass();
    const spyglass = harness.controller.frame().camera!.pose;
    expect(spyglass.viewDistance ?? 0).toBeLessThan(620);
    expect(spyglass.viewDistance ?? 0).toBeGreaterThan(pose.viewDistance ?? 0);
  });

  it("closes other windows only after an entry is accepted", async () => {
    const closeWindows = vi.fn();
    const accepted = createHarness(closeWindows);
    await enterAndPossess(accepted);
    expect(closeWindows).toHaveBeenCalledTimes(1);
    const refused = createHarness(closeWindows);
    refused.setInputAvailable(false);
    await expect(refused.controller.enter()).resolves.toEqual({ ok: false, reason: "input-busy" });
    expect(closeWindows).toHaveBeenCalledTimes(1);
  });

  it("keeps movement and look intents idempotent, clamped and clearable", async () => {
    const harness = createHarness();
    await enterAndPossess(harness);
    const start = harness.controller.frame().camera!.pose;
    harness.controller.setMovement(1, 0);
    harness.controller.update(0.1);
    const first = harness.controller.frame().camera!.pose;
    harness.controller.setMovement(1, 0);
    harness.controller.setMovement(1, 0);
    harness.controller.update(0.1);
    const second = harness.controller.frame().camera!.pose;
    expect(first.z - start.z).toBeCloseTo(second.z - first.z);
    expect(harness.controller.frame().camera!.pose.x).toBeCloseTo(start.x);

    harness.controller.setLook(0, 100);
    harness.controller.update(0.25);
    expect(harness.controller.frame().camera!.pose.pitch).toBeCloseTo(1.361356816555577);
    harness.controller.clearInputs();
    const cleared = harness.controller.frame().camera!.pose;
    harness.controller.update(0.1);
    expect(harness.controller.frame().camera!.pose.z).toBe(cleared.z);
  });

  it("ends the mode safely when standing clearance disappears", async () => {
    const harness = createHarness();
    await enterAndPossess(harness);
    const bubble = harness.controller.frame().bubble;
    expect(bubble).not.toBeNull();
    harness.groundFlags.clear = false;
    harness.controller.update(0.1);
    expect(harness.controller.phase()).toBe("returning");
    expect(harness.controller.snapshot().notice).toBe("The explorer can no longer stand safely.");
    expect(harness.controller.frame().bubble).toBeNull();
    expect(harness.visibilityBubbles.at(-1)).toBeNull();
    harness.advance(2_000);
    harness.controller.update(0);
    expect(harness.controller.phase()).toBe("dissipating");
    harness.advance(1_000);
    harness.controller.update(0);
    harness.advance(3_000);
    harness.controller.update(0);
    expect(harness.controller.phase()).toBe("idle");
  });

  it("forces a session exit when the home context or generation changes", async () => {
    const changedHome = createHarness();
    await enterAndPossess(changedHome);
    changedHome.setContext({ editor: true });
    changedHome.controller.update(0.1);
    expect(changedHome.controller.phase()).toBe("idle");
    expect(changedHome.leases[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(changedHome.visibilityBubbles.at(-1)).toBeNull();

    const changedIdentity = createHarness();
    await enterAndPossess(changedIdentity);
    changedIdentity.identity.generation = 2;
    changedIdentity.controller.update(0.1);
    expect(changedIdentity.controller.phase()).toBe("idle");
    expect(changedIdentity.leases[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it("supports a background request without waiting for dwell or smoke", async () => {
    const harness = createHarness();
    await enterAndPossess(harness);
    harness.advance(100);
    harness.controller.requestLeave("background");
    expect(harness.controller.phase()).toBe("idle");
    expect(harness.leases[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(harness.weatherActive.at(-1)).toBe(false);
    expect(harness.smokeBursts.map(burst => burst.kind)).toEqual(["arrival"]);
  });

  it("touches only the frozen presentation adapters", async () => {
    const harness = createHarness();
    expect(Object.keys(harness.host).sort()).toEqual([
      "appearance", "camera", "ground", "identity", "now", "smoke", "ui", "visibility", "weather"
    ]);
    expect(harness.host).not.toHaveProperty("save");
    expect(harness.host).not.toHaveProperty("simulation");
    await enterAndPossess(harness);
    harness.controller.dispose();
    expect(Object.keys(harness.host).sort()).toEqual([
      "appearance", "camera", "ground", "identity", "now", "smoke", "ui", "visibility", "weather"
    ]);
  });
});
