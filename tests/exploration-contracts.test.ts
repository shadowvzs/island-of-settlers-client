import { describe, expect, it } from "vitest";

import {
  createExplorationCameraBoundary,
  createIdleExplorationSnapshot,
  EXPLORATION_BUBBLE_RADIUS_CELLS,
  EXPLORATION_DISAPPEAR_SECONDS,
  EXPLORATION_ENTRY_SECONDS,
  EXPLORATION_MIN_EXIT_LOCKOUT_MS,
  EXPLORATION_POSSESSED_DWELL_SECONDS,
  EXPLORATION_POST_EFFECT_COOLDOWN_MS,
  EXPLORATION_RETURN_SECONDS,
  explorationInputPolicy,
  explorationLeaveUnlockAt,
  explorationReadyAt,
  homeExplorationEligibility,
  rtsCameraEquals,
  snapshotRtsCamera
} from "../src/app/exploration/contracts";
import type { CameraState } from "../src/render-common/camera-state";
import { isExplorationFrameActive } from "../src/render-common/exploration/exploration-frame";

const RTS: CameraState = {
  centerX: 12, centerZ: 18, tilt: 0.1, viewportHeight: 900, viewportWidth: 1440,
  yaw: 0.2, zoom: 1.4
};

describe("exploration contracts", () => {
  it("accepts only the active home settlement, not a colony with an archived home document", () => {
    expect(homeExplorationEligibility({
      activeAdventure: null, activeColony: null, editor: false, homeIsland: true, playback: false,
      sandbox: false, settlement: true
    })).toEqual({ eligible: true });
    for (const [context, reason] of [
      [{ activeColony: 3 }, "not-home"],
      [{ activeAdventure: 2 }, "not-home"],
      [{ homeIsland: false }, "not-home"],
      [{ editor: true }, "editor"],
      [{ playback: true }, "playback"],
      [{ sandbox: true }, "sandbox"],
      [{ settlement: false }, "not-settlement"]
    ] as const) {
      expect(homeExplorationEligibility({
        activeAdventure: null, activeColony: null, editor: false, homeIsland: true, playback: false,
        sandbox: false, settlement: true, ...context
      })).toEqual({ eligible: false, reason });
    }
  });

  it("keeps normal input suppressed for the whole visual mode and movement only while possessed", () => {
    expect(explorationInputPolicy("idle")).toMatchObject({
      toggleHotkeys: false, commander: { attack: false, block: false, dismount: false },
      jump: false, fullscreen: false, forward: false, backward: false,
      turnLeft: false, turnRight: false, zoomIn: false, zoomOut: false,
      suppressNormal: false, move: false, look: false, spyglass: false, leave: false
    });
    expect(explorationInputPolicy("entering")).toMatchObject({ suppressNormal: true, move: false, look: false });
    expect(explorationInputPolicy("possessed")).toMatchObject({
      toggleHotkeys: true, commander: { attack: false, block: false, dismount: false },
      jump: true, fullscreen: true, forward: true, backward: true,
      turnLeft: true, turnRight: true, zoomIn: true, zoomOut: true,
      suppressNormal: true, move: true, look: true, spyglass: true, leave: true
    });
    expect(explorationInputPolicy("returning")).toMatchObject({ suppressNormal: true, move: false, leave: true });
    expect(explorationInputPolicy("cooldown")).toMatchObject({ suppressNormal: false, move: false });
    expect(explorationInputPolicy("possessed", "unknown")).toMatchObject({
      toggleHotkeys: false, commander: { attack: false },
      move: false, look: false, jump: false, spyglass: false, fullscreen: false,
      zoomIn: false, zoomOut: false, leave: true, suppressNormal: true
    });
    expect(explorationInputPolicy("possessed", "commander")).toMatchObject({
      jump: false, spyglass: false, toggleHotkeys: true,
      commander: { attack: true, block: true, dismount: true, callHorse: true, followAll: true, holdAll: true }
    });
  });

  it("never lets an eye pose overwrite the saved/gameplay RTS camera", () => {
    const original = { ...RTS };
    const boundary = createExplorationCameraBoundary(original);
    original.centerX = 99;
    expect(boundary.savedRts()).toEqual(RTS);
    expect(boundary.gameplayCamera()).toEqual(RTS);
    expect(boundary.frame().camera).toBeNull();

    boundary.setPose({ eyeHeight: 1.7, fov: 1.1, mode: "eye", pitch: -0.1, x: 3, y: 4, z: 5, yaw: 0.7 });
    boundary.setBubble({ centerX: 3, centerZ: 5, radiusCells: 8, revision: 1 });
    expect(boundary.frame().camera?.pose).toMatchObject({ x: 3, z: 5, mode: "eye" });
    expect(boundary.frame().bubble?.radiusCells).toBe(8);
    expect(boundary.frame().revision).toBe(2);
    expect(boundary.savedRts()).toEqual(RTS);
    expect(boundary.gameplayCamera()).toEqual(RTS);
    expect(rtsCameraEquals(boundary.savedRts(), boundary.gameplayCamera())).toBe(true);
    expect(isExplorationFrameActive(boundary.frame())).toBe(true);

    boundary.clearTransient();
    expect(boundary.frame()).toMatchObject({ appearance: null, bubble: null, camera: null, smoke: null, weather: null });
    expect(boundary.frame().revision).toBe(3);
    expect(boundary.savedRts()).toEqual(RTS);
  });

  it("returns camera copies, so a renderer cannot mutate the save boundary", () => {
    const boundary = createExplorationCameraBoundary(RTS);
    const copy = snapshotRtsCamera(boundary.savedRts());
    copy.centerX = -2;
    expect(boundary.savedRts().centerX).toBe(RTS.centerX);
  });

  it("keeps the minimum exit lockout after the smoke is gone", () => {
    expect(explorationReadyAt(1_000, 1_800)).toBe(7_000);
    expect(explorationReadyAt(1_000, 5_000)).toBe(8_000);
    expect(EXPLORATION_MIN_EXIT_LOCKOUT_MS).toBe(6_000);
    expect(EXPLORATION_POST_EFFECT_COOLDOWN_MS).toBe(3_000);
    expect(EXPLORATION_ENTRY_SECONDS).toBe(4);
    expect(EXPLORATION_POSSESSED_DWELL_SECONDS).toBe(2);
    expect(EXPLORATION_RETURN_SECONDS).toBe(2);
    expect(EXPLORATION_DISAPPEAR_SECONDS).toBe(1);
    expect(EXPLORATION_BUBBLE_RADIUS_CELLS).toBe(8);
    expect(explorationLeaveUnlockAt(2_000)).toBe(4_000);
  });

  it("starts with an immutable idle snapshot", () => {
    expect(createIdleExplorationSnapshot({ eligible: true })).toEqual({
      canEnter: false, cooldownInMs: 0, eligibility: { eligible: true }, leaveUnlockInMs: 0,
      phase: "idle", progress: 0, spyglass: false
    });
  });
});
