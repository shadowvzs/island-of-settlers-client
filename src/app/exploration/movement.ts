/**
 * Read-only movement and look for the temporary presentation body (EXPLORE-01B). The body has no
 * simulation actor, UID, reservation or collision occupancy: it only samples the canonical ground
 * query and moves a transient pose.
 */
import {
  EXPLORATION_FIELD_OF_VIEW,
  type ExplorationPose
} from "../../render-common/exploration/exploration-frame";
import { WORKER_HEIGHT } from "../../render-common/workers/worker-dimensions";
import type { ExplorationGroundQuery, ExplorationSpawnPoint } from "./contracts";

/** The body capsule is deliberately smaller than a gameplay worker; possessed collision uses half. */
export const EXPLORATION_BODY_RADIUS = 0.16;
/** A slightly larger horizontal eye/head clearance keeps the camera out of walls and props. */
export const EXPLORATION_EYE_CLEARANCE_RADIUS = 0.46;
export const EXPLORATION_EYE_HEIGHT = WORKER_HEIGHT * 0.91;
export const EXPLORATION_WALK_SPEED = 4.2;
/** Largest terrain rise/fall a single step may cross; canonical walkability still owns cliffs. */
export const EXPLORATION_MAX_STEP_HEIGHT = 0.55;
/** Guard against a background gap turning one update into a teleport. */
export const EXPLORATION_MAX_DELTA_SECONDS = 0.25;
/** Collision is sampled in short steps instead of one long jump. */
export const EXPLORATION_MAX_MOVE_SUBSTEP = 0.45;
/** Radians per second at the horizontal look limit. */
export const EXPLORATION_MAX_LOOK_RATE = Math.PI * 2;
export const EXPLORATION_MIN_PITCH = (-65 * Math.PI) / 180;
export const EXPLORATION_MAX_PITCH = (78 * Math.PI) / 180;
export { EXPLORATION_FIELD_OF_VIEW };
/** 50% stronger magnification than the former 34° spyglass view (narrower field, same eye pose). */
export const EXPLORATION_SPYGLASS_FIELD_OF_VIEW = (34 / 1.5 * Math.PI) / 180;
/** Player-adjustable spyglass magnification: 2× wide through 8× close. */
export const EXPLORATION_SPYGLASS_ZOOM_MIN = 2;
export const EXPLORATION_SPYGLASS_ZOOM_MAX = 8;
export const EXPLORATION_SPYGLASS_ZOOM_DEFAULT = 3;
export const EXPLORATION_SPYGLASS_ZOOM_STEP = 0.1;
/** Keep the current default view at 3× and scale the field linearly inside the allowed range. */
export const explorationSpyglassFieldOfView = (zoom: number) => {
  const bounded = Math.min(EXPLORATION_SPYGLASS_ZOOM_MAX,
    Math.max(EXPLORATION_SPYGLASS_ZOOM_MIN, Number.isFinite(zoom) ? zoom : EXPLORATION_SPYGLASS_ZOOM_DEFAULT));
  return EXPLORATION_SPYGLASS_FIELD_OF_VIEW * (EXPLORATION_SPYGLASS_ZOOM_DEFAULT / bounded);
};
/** Normal eye sight is deliberately bounded; the spyglass is the only longer sight line. */
export const EXPLORATION_VIEW_DISTANCE = 260;
export const EXPLORATION_SPYGLASS_VIEW_DISTANCE = 620;

export interface ExplorationBody {
  pitch: number;
  x: number;
  yaw: number;
  z: number;
}

export interface ExplorationMovementIntent {
  forward: number;
  right: number;
}

export interface ExplorationLookIntent {
  pitch: number;
  yaw: number;
}

export interface ExplorationMoveResult {
  /** At least one axis was blocked by water, clearance, bounds, slope or walkability. */
  blocked: boolean;
  body: ExplorationBody;
  /** The body no longer stands on valid ground or lost its capsule clearance. */
  standingInvalid: boolean;
}

export const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const clampExplorationDeltaSeconds = (deltaSeconds: number) => {
  if (!(deltaSeconds > 0)) return 0;
  return Math.min(deltaSeconds, EXPLORATION_MAX_DELTA_SECONDS);
};

/** Wraps an angle to [-PI, PI); the eye pose never needs an unbounded yaw. */
export const normalizeExplorationAngle = (angle: number) => {
  if (!Number.isFinite(angle)) return 0;
  const wrapped = ((angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  return wrapped - Math.PI;
};

export const clampExplorationPitch = (pitch: number) =>
  clampNumber(Number.isFinite(pitch) ? pitch : 0, EXPLORATION_MIN_PITCH, EXPLORATION_MAX_PITCH);

export const createExplorationBody = (
  point: Pick<ExplorationSpawnPoint, "x" | "z">,
  yaw = 0
): ExplorationBody => ({
  pitch: 0,
  x: point.x,
  yaw: normalizeExplorationAngle(yaw),
  z: point.z
});

export const createExplorationMovementIntent = (
  forward: number,
  right: number
): ExplorationMovementIntent => ({
  forward: Number.isFinite(forward) ? clampNumber(forward, -1, 1) : 0,
  right: Number.isFinite(right) ? clampNumber(right, -1, 1) : 0
});

export const createExplorationLookIntent = (yaw: number, pitch: number): ExplorationLookIntent => ({
  pitch: Number.isFinite(pitch) ? clampNumber(pitch, -EXPLORATION_MAX_LOOK_RATE, EXPLORATION_MAX_LOOK_RATE) : 0,
  yaw: Number.isFinite(yaw) ? clampNumber(yaw, -EXPLORATION_MAX_LOOK_RATE, EXPLORATION_MAX_LOOK_RATE) : 0
});

export const isInsideExplorationMap = (
  ground: Pick<ExplorationGroundQuery, "cellsX" | "cellsZ">,
  x: number,
  z: number,
  radius = EXPLORATION_BODY_RADIUS
) =>
  Number.isFinite(x) && Number.isFinite(z) && x >= radius && z >= radius &&
  x <= ground.cellsX - radius && z <= ground.cellsZ - radius;

/** The canonical walkability/water/clearance test for the body capsule at a point. */
export const canOccupyExplorationPoint = (
  ground: ExplorationGroundQuery,
  x: number,
  z: number
) => {
  if (!isInsideExplorationMap(ground, x, z)) return false;
  if (!Number.isFinite(ground.groundHeight(x, z))) return false;
  const wading = ground.isWadeable?.(x, z) === true;
  if (!wading && (ground.isWater(x, z) || !ground.isWalkable(x, z))) return false;
  return ground.isClear(x, z, EXPLORATION_BODY_RADIUS);
};

export const isExplorationStandingValid = (
  ground: ExplorationGroundQuery,
  x: number,
  z: number
) => canOccupyExplorationPoint(ground, x, z);

/** Whether the capsule may cross from one grounded point to another. */
export const canStepExplorationPoint = (
  ground: ExplorationGroundQuery,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number
) => {
  const fromHeight = ground.groundHeight(fromX, fromZ), toHeight = ground.groundHeight(toX, toZ);
  if (!Number.isFinite(fromHeight) || !Number.isFinite(toHeight)) return false;
  if (Math.abs(toHeight - fromHeight) > EXPLORATION_MAX_STEP_HEIGHT) return false;
  return canOccupyExplorationPoint(ground, toX, toZ);
};

const attemptAxisMove = (
  ground: ExplorationGroundQuery,
  body: ExplorationBody,
  nextX: number,
  nextZ: number,
  result: { blocked: boolean }
) => {
  if (canStepExplorationPoint(ground, body.x, body.z, nextX, nextZ)) {
    body.x = nextX;
    body.z = nextZ;
    return;
  }
  result.blocked = true;
};

/**
 * Applies an idempotent movement intent for one update. A blocked diagonal slides along the free
 * axis; the caller ends the mode if `standingInvalid` reports that clearance disappeared.
 */
export const moveExplorationBody = (
  body: ExplorationBody,
  ground: ExplorationGroundQuery,
  intent: ExplorationMovementIntent,
  deltaSeconds: number
): ExplorationMoveResult => {
  const movement = createExplorationMovementIntent(intent.forward, intent.right);
  const delta = clampExplorationDeltaSeconds(deltaSeconds);
  if (!isExplorationStandingValid(ground, body.x, body.z)) {
    return { blocked: true, body, standingInvalid: true };
  }
  if (delta === 0 || (movement.forward === 0 && movement.right === 0)) {
    return { blocked: false, body, standingInvalid: false };
  }
  const magnitude = Math.hypot(movement.forward, movement.right);
  if (!(magnitude > 0)) return { blocked: false, body, standingInvalid: false };

  const scale = (EXPLORATION_WALK_SPEED * delta) / Math.max(1, magnitude);
  const sinYaw = Math.sin(body.yaw), cosYaw = Math.cos(body.yaw);
  // Yaw is the facing angle from +Z; screen-right is -X at yaw 0 for a camera looking +Z.
  const totalX = (sinYaw * movement.forward - cosYaw * movement.right) * scale;
  const totalZ = (cosYaw * movement.forward + sinYaw * movement.right) * scale;
  const distance = Math.hypot(totalX, totalZ);
  const steps = Math.max(1, Math.ceil(distance / EXPLORATION_MAX_MOVE_SUBSTEP));
  const stepX = totalX / steps, stepZ = totalZ / steps;
  const next = { ...body };
  const result = { blocked: false };
  for (let step = 0; step < steps; step += 1) {
    const fromX = next.x, fromZ = next.z;
    const combinedX = fromX + stepX, combinedZ = fromZ + stepZ;
    if (canStepExplorationPoint(ground, fromX, fromZ, combinedX, combinedZ)) {
      next.x = combinedX;
      next.z = combinedZ;
      continue;
    }
    attemptAxisMove(ground, next, combinedX, fromZ, result);
    attemptAxisMove(ground, next, next.x, combinedZ, result);
  }
  const standingInvalid = !isExplorationStandingValid(ground, next.x, next.z);
  return { blocked: result.blocked, body: next, standingInvalid };
};

/** Applies yaw/pitch rates for one update and clamps the eye angles. */
export const lookExplorationBody = (
  body: ExplorationBody,
  intent: ExplorationLookIntent,
  deltaSeconds: number
): ExplorationBody => {
  const delta = clampExplorationDeltaSeconds(deltaSeconds);
  const look = createExplorationLookIntent(intent.yaw, intent.pitch);
  if (delta === 0) {
    return {
      ...body,
      pitch: clampExplorationPitch(body.pitch),
      yaw: normalizeExplorationAngle(body.yaw)
    };
  }
  return {
    ...body,
    pitch: clampExplorationPitch(body.pitch + look.pitch * delta),
    yaw: normalizeExplorationAngle(body.yaw + look.yaw * delta)
  };
};

export const explorationEyeHeightAt = (
  ground: ExplorationGroundQuery,
  x: number,
  z: number,
  eyeHeight = EXPLORATION_EYE_HEIGHT
) => {
  const height = ground.groundHeight(x, z);
  return Number.isFinite(height) ? height + eyeHeight : eyeHeight;
};

/** Builds the transient eye pose; `mode` is transition while the camera blends in or out. */
export const explorationPoseFromBody = (
  ground: ExplorationGroundQuery,
  body: ExplorationBody,
  mode: ExplorationPose["mode"],
  spyglass = false,
  eyeHeight = EXPLORATION_EYE_HEIGHT,
  spyglassZoom = EXPLORATION_SPYGLASS_ZOOM_DEFAULT
): ExplorationPose => ({
  eyeHeight,
  fov: spyglass ? explorationSpyglassFieldOfView(spyglassZoom) : EXPLORATION_FIELD_OF_VIEW,
  mode,
  pitch: clampExplorationPitch(body.pitch),
  viewDistance: spyglass ? EXPLORATION_SPYGLASS_VIEW_DISTANCE : EXPLORATION_VIEW_DISTANCE,
  x: body.x,
  y: explorationEyeHeightAt(ground, body.x, body.z, eyeHeight),
  yaw: normalizeExplorationAngle(body.yaw),
  z: body.z
});
