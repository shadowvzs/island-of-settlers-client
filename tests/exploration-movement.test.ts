import { describe, expect, it } from "vitest";

import type { ExplorationGroundQuery } from "../src/app/exploration/contracts";
import {
  canStepExplorationPoint,
  clampExplorationDeltaSeconds,
  createExplorationBody,
  createExplorationLookIntent,
  createExplorationMovementIntent,
  EXPLORATION_FIELD_OF_VIEW,
  EXPLORATION_MAX_PITCH,
  EXPLORATION_SPYGLASS_FIELD_OF_VIEW,
  EXPLORATION_SPYGLASS_VIEW_DISTANCE,
  EXPLORATION_VIEW_DISTANCE,
  explorationEyeHeightAt,
  explorationPoseFromBody,
  isExplorationStandingValid,
  lookExplorationBody,
  moveExplorationBody
} from "../src/app/exploration/movement";

interface GroundOptions {
  blocked?: (x: number, z: number) => boolean;
  cellsX?: number;
  cellsZ?: number;
  clear?: (x: number, z: number, radius: number) => boolean;
  height?: (x: number, z: number) => number;
  water?: (x: number, z: number) => boolean;
}

const createGround = (options: GroundOptions = {}): ExplorationGroundQuery => ({
  cellsX: options.cellsX ?? 12,
  cellsZ: options.cellsZ ?? 12,
  groundHeight: options.height ?? (() => 0),
  isClear: options.clear ?? (() => true),
  isOwned: () => true,
  isWalkable: (x, z) => !options.blocked?.(x, z),
  isWater: options.water ?? (() => false)
});

describe("exploration movement", () => {
  it("builds a ground-following eye pose and a narrower spyglass view", () => {
    const ground = createGround({ height: (x, z) => x * 0.1 + z * 0.2 });
    const body = createExplorationBody({ x: 2, z: 3 }, 0.5);
    const pose = explorationPoseFromBody(ground, body, "eye");
    expect(pose).toMatchObject({
      eyeHeight: 0.966875, fov: EXPLORATION_FIELD_OF_VIEW, mode: "eye", x: 2, yaw: 0.5, z: 3
    });
    expect(pose.y).toBeCloseTo(1.766875);
    expect(pose.viewDistance).toBe(EXPLORATION_VIEW_DISTANCE);
    const spyglass = explorationPoseFromBody(ground, body, "transition", true);
    expect(spyglass.fov).toBe(EXPLORATION_SPYGLASS_FIELD_OF_VIEW);
    expect(spyglass.viewDistance).toBe(EXPLORATION_SPYGLASS_VIEW_DISTANCE);
    const wide = explorationPoseFromBody(ground, body, "eye", true, undefined, 2);
    const close = explorationPoseFromBody(ground, body, "eye", true, undefined, 4);
    expect(wide.fov).toBeCloseTo(EXPLORATION_SPYGLASS_FIELD_OF_VIEW * 1.5);
    expect(close.fov).toBeCloseTo(EXPLORATION_SPYGLASS_FIELD_OF_VIEW * 0.75);
    expect(explorationEyeHeightAt(ground, 2, 3, 1.62)).toBeCloseTo(2.42);
  });

  it("moves forward and sideways in ground units at the intended speed", () => {
    const ground = createGround();
    const start = createExplorationBody({ x: 2, z: 2 });
    const forward = moveExplorationBody(start, ground, { forward: 1, right: 0 }, 0.1);
    expect(forward.blocked).toBe(false);
    expect(forward.body.x).toBeCloseTo(2);
    expect(forward.body.z).toBeCloseTo(2.42);
    const right = moveExplorationBody(start, ground, { forward: 0, right: 1 }, 0.1);
    expect(right.body.x).toBeCloseTo(1.58);
    expect(right.body.z).toBeCloseTo(2);
    const diagonal = moveExplorationBody(start, ground, { forward: 1, right: 1 }, 0.1);
    expect(Math.hypot(diagonal.body.x - 2, diagonal.body.z - 2)).toBeCloseTo(0.42);
  });

  it("normalizes combined intents and clamps oversized update deltas", () => {
    expect(createExplorationMovementIntent(2, -2)).toEqual({ forward: 1, right: -1 });
    expect(createExplorationMovementIntent(Number.NaN, 0)).toEqual({ forward: 0, right: 0 });
    expect(clampExplorationDeltaSeconds(5)).toBe(0.25);
    const ground = createGround();
    const start = createExplorationBody({ x: 2, z: 2 });
    const far = moveExplorationBody(start, ground, { forward: 1, right: 0 }, 5);
    expect(far.body.z).toBeCloseTo(2 + 4.2 * 0.25);
  });

  it("blocks water, map bounds, clearance and steep cliffs, sliding on a free axis", () => {
    const water = createGround({ water: (_x, z) => z >= 4 });
    const fromShore = createExplorationBody({ x: 2, z: 3.9 });
    expect(moveExplorationBody(fromShore, water, { forward: 1, right: 0 }, 0.25).body.z)
      .toBeCloseTo(3.9);

    const bounds = createGround({ cellsX: 8, cellsZ: 8 });
    const nearEdge = createExplorationBody({ x: 7.5, z: 2 });
    expect(moveExplorationBody(nearEdge, bounds, { forward: 0, right: -1 }, 0.25).body.x)
      .toBeCloseTo(7.5);

    const blockedX = createGround({ blocked: x => x >= 3 });
    const sliding = moveExplorationBody(
      createExplorationBody({ x: 2.9, z: 2 }), blockedX, { forward: 1, right: -1 }, 0.1
    );
    expect(sliding.blocked).toBe(true);
    expect(sliding.body.x).toBeCloseTo(2.9);
    expect(sliding.body.z).toBeGreaterThan(2);

    const cliff = createGround({ height: (_x, z) => z >= 4 ? 2 : 0 });
    const atCliff = createExplorationBody({ x: 2, z: 3.9 });
    expect(moveExplorationBody(atCliff, cliff, { forward: 1, right: 0 }, 0.25).body.z)
      .toBeCloseTo(3.9);
    expect(canStepExplorationPoint(cliff, 2, 3.9, 2, 4.2)).toBe(false);
  });

  it("ends safely when clearance disappears under the standing body", () => {
    let clear = true;
    const ground = createGround({ clear: () => clear });
    const body = createExplorationBody({ x: 2, z: 2 });
    expect(isExplorationStandingValid(ground, body.x, body.z)).toBe(true);
    clear = false;
    const result = moveExplorationBody(body, ground, { forward: 1, right: 0 }, 0.1);
    expect(result).toMatchObject({ body, standingInvalid: true });
    expect(result.blocked).toBe(true);
  });

  it("clamps look rates and pitch while wrapping yaw into one turn", () => {
    const body = createExplorationBody({ x: 2, z: 2 });
    expect(createExplorationLookIntent(100, -100)).toEqual({
      pitch: -Math.PI * 2, yaw: Math.PI * 2
    });
    const looked = lookExplorationBody(body, { pitch: 100, yaw: 100 }, 0.25);
    expect(looked.pitch).toBe(EXPLORATION_MAX_PITCH);
    expect(looked.yaw).toBeGreaterThanOrEqual(-Math.PI);
    expect(looked.yaw).toBeLessThan(Math.PI);
    const wrapped = lookExplorationBody(
      { ...body, yaw: Math.PI * 3 }, { pitch: 0, yaw: 0 }, 0
    );
    expect(wrapped.yaw).toBeGreaterThanOrEqual(-Math.PI);
    expect(wrapped.yaw).toBeLessThan(Math.PI);
  });
});
