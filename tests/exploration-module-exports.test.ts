import { describe, expect, it } from "vitest";

import { elapsedMilliseconds } from "../src/app/exploration/clock";
import {
  canOccupyExplorationPoint,
  clampExplorationPitch,
  clampNumber,
  EXPLORATION_EYE_HEIGHT,
  EXPLORATION_MAX_DELTA_SECONDS,
  EXPLORATION_MAX_LOOK_RATE,
  EXPLORATION_MAX_MOVE_SUBSTEP,
  EXPLORATION_MAX_STEP_HEIGHT,
  EXPLORATION_MIN_PITCH,
  EXPLORATION_WALK_SPEED,
  normalizeExplorationAngle
} from "../src/app/exploration/movement";
import {
  EXPLORATION_SPAWN_ANCHOR_RADIUS,
  EXPLORATION_SPAWN_COAST_WATER_DISTANCE,
  EXPLORATION_SPAWN_CONNECTED_DISTANCE,
  EXPLORATION_SPAWN_FOCUS_RADIUS,
  EXPLORATION_SPAWN_MAX_CANDIDATES,
  EXPLORATION_SPAWN_MAX_HEIGHT_DRIFT,
  EXPLORATION_SPAWN_MIN_CONNECTED,
  EXPLORATION_SPAWN_MIN_NEIGHBOURS,
  EXPLORATION_SPAWN_NEIGHBOUR_DISTANCE,
  EXPLORATION_SPAWN_TIME_BUDGET_MS
} from "../src/app/exploration/spawn";
import {
  clampExplorationPose,
  createExplorationAppearanceAdapter,
  createExplorationCameraRig,
  createExplorationLodAdapter,
  createExplorationSmokeAdapter,
  createExplorationSmokeModel,
  createExplorationSpyglass,
  createLiveExplorationBodyLoader,
  createOwnedExplorationAppearanceAdapter,
  createOwnedExplorationBodyLoader,
  createSharedExplorationBodyLoader,
  EXPLORATION_APPEARANCE_ASSET_GAPS,
  EXPLORATION_LOD_DEFAULTS,
  EXPLORATION_LOD_LOAD_POLICY,
  EXPLORATION_NATIONS,
  EXPLORATION_PORTRAIT_BODIES,
  EXPLORATION_SMOKE_COLORS,
  EXPLORATION_SMOKE_DURATION_MS,
  EXPLORATION_SMOKE_MAX_PARTICLES,
  explorationBlendEase,
  explorationBodyVisibility,
  explorationLodAtDistance,
  explorationLookDirection,
  explorationNationBodies,
  explorationRtsCameraView,
  isExplorationWorkerNation,
  measureExplorationRig,
  PRESENTATION_SMOKE_SEED,
  resolveExplorationAppearance,
  wrapExplorationYaw
} from "../src/renderers/three/exploration";

describe("exploration module exports (integration surface)", () => {
  it("keeps the movement and spawn tuning values available to the coordinator", () => {
    expect(EXPLORATION_EYE_HEIGHT).toBeCloseTo(0.966875);
    expect(EXPLORATION_WALK_SPEED).toBeGreaterThan(0);
    expect(EXPLORATION_MAX_STEP_HEIGHT).toBeGreaterThan(0);
    expect(EXPLORATION_MAX_DELTA_SECONDS).toBeGreaterThan(0);
    expect(EXPLORATION_MAX_MOVE_SUBSTEP).toBeGreaterThan(0);
    expect(EXPLORATION_MAX_LOOK_RATE).toBeGreaterThan(0);
    expect(EXPLORATION_MIN_PITCH).toBeLessThan(0);
    expect(clampNumber(4, 0, 2)).toBe(2);
    expect(normalizeExplorationAngle(Math.PI * 4)).toBeCloseTo(0, 6);
    expect(clampExplorationPitch(10)).toBeLessThan(10);
    const ground = { cellsX: 16, cellsZ: 16, groundHeight: () => 0, isClear: () => true,
      isOwned: () => true, isWalkable: () => true, isWater: () => false };
    expect(canOccupyExplorationPoint(ground, 1, 1)).toBe(true);
    expect(elapsedMilliseconds(30, 10)).toBe(20);
    expect(EXPLORATION_SPAWN_MAX_CANDIDATES).toBeGreaterThan(0);
    expect(EXPLORATION_SPAWN_TIME_BUDGET_MS).toBeGreaterThan(0);
    expect(EXPLORATION_SPAWN_FOCUS_RADIUS).toBeGreaterThan(0);
    expect(EXPLORATION_SPAWN_ANCHOR_RADIUS).toBeGreaterThan(0);
    expect(EXPLORATION_SPAWN_NEIGHBOUR_DISTANCE).toBeGreaterThan(0);
    expect(EXPLORATION_SPAWN_MIN_NEIGHBOURS).toBeGreaterThan(0);
    expect(EXPLORATION_SPAWN_COAST_WATER_DISTANCE).toBeGreaterThan(0);
    expect(EXPLORATION_SPAWN_CONNECTED_DISTANCE).toBeGreaterThan(0);
    expect(EXPLORATION_SPAWN_MIN_CONNECTED).toBeGreaterThan(0);
    expect(EXPLORATION_SPAWN_MAX_HEIGHT_DRIFT).toBeGreaterThan(0);
  });

  it("exports the renderer factories and nation descriptors the coordinator will wire", () => {
    expect(typeof createOwnedExplorationBodyLoader).toBe("function");
    expect(typeof createOwnedExplorationAppearanceAdapter).toBe("function");
    expect(typeof createExplorationSpyglass).toBe("function");
    expect(explorationNationBodies("roman")).toBeDefined();
    expect(isExplorationWorkerNation("roman")).toBe(true);
    expect(isExplorationWorkerNation("unknown")).toBe(false);
    for (const factory of [createExplorationAppearanceAdapter, createExplorationCameraRig,
      createExplorationLodAdapter, createExplorationSmokeAdapter, createExplorationSmokeModel,
      createLiveExplorationBodyLoader, createSharedExplorationBodyLoader, resolveExplorationAppearance,
      measureExplorationRig,
      explorationBodyVisibility, explorationLodAtDistance, explorationRtsCameraView])
      expect(typeof factory).toBe("function");
    for (const value of [EXPLORATION_APPEARANCE_ASSET_GAPS, EXPLORATION_LOD_DEFAULTS,
      EXPLORATION_LOD_LOAD_POLICY, EXPLORATION_NATIONS, EXPLORATION_PORTRAIT_BODIES,
      EXPLORATION_SMOKE_COLORS, EXPLORATION_SMOKE_DURATION_MS, EXPLORATION_SMOKE_MAX_PARTICLES,
      PRESENTATION_SMOKE_SEED]) expect(value).toBeDefined();
    expect(clampExplorationPose({ eyeHeight: 1, fov: 1, mode: "eye", pitch: 0, x: 0, y: 0, z: 0,
      yaw: 0 }, { groundHeight: () => 0 })).toBeDefined();
    expect(explorationBlendEase(0.5)).toBeGreaterThan(0);
    expect(explorationLookDirection(0, 0)).toBeDefined();
    expect(wrapExplorationYaw(Math.PI * 3)).toBeLessThanOrEqual(Math.PI);
  });
});
