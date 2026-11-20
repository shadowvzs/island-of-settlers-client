import { DMath } from "../math/deterministic-math";
import {
  TROOP_GLIDE_MAX_SECONDS as GLIDE_MAX_SECONDS, TROOP_GLIDE_MIN_SECONDS as GLIDE_MIN_SECONDS,
  TROOP_GLIDE_POSE_TOLERANCE as POSE_TOLERANCE, TROOP_GLIDE_SPEED as GLIDE_SPEED,
  TROOP_GLIDE_TURN_SPEED as GLIDE_TURN_SPEED
} from "./constants";
import type { AdventureLanding } from "./settlement-adventure-landing";
import type { SettlementPoint } from "./settlement-types";

/**
 * A troop ship easing onto its coast anchorage pose from where its helm stopped (2026-11-17): the last tiles of a
 * tight swing, so nobody aboard is moved or turned in one tick. Saved on the mission; the pose is a pure function
 * of it, so a reload continues the same glide.
 */
export interface AnchorGlide extends SettlementPoint {
  elapsed: number;
  yaw: number;
}

interface ShipPose extends SettlementPoint { yaw: number }

const turnBetween = (from: number, to: number) => DMath.atan2(DMath.sin(to - from), DMath.cos(to - from));

/** Seconds the glide from `from` onto `landing` takes. */
const glideSeconds = (from: ShipPose, landing: AdventureLanding) => {
  const distance = DMath.hypot(landing.water.x - from.x, landing.water.z - from.z);
  const turn = Math.abs(turnBetween(from.yaw, landing.yaw));
  return Math.min(GLIDE_MAX_SECONDS, Math.max(GLIDE_MIN_SECONDS, distance / GLIDE_SPEED, turn / GLIDE_TURN_SPEED));
};

/** Whether `ship` already lies on the anchorage pose. */
export const liesAtAnchorage = (ship: ShipPose, landing: AdventureLanding) =>
  DMath.hypot(landing.water.x - ship.x, landing.water.z - ship.z) <= POSE_TOLERANCE &&
  Math.abs(turnBetween(ship.yaw, landing.yaw)) <= POSE_TOLERANCE;

/** The glide starting from where `ship` lies now. */
export const startAnchorGlide = (ship: ShipPose): AnchorGlide => ({ elapsed: 0, x: ship.x, yaw: ship.yaw, z: ship.z });

/**
 * One tick of the glide: `ship` moves (smoothstep) from the glide's start onto the anchorage pose. True once it lies
 * exactly on it.
 */
export const advanceAnchorGlide = (ship: ShipPose & { speed?: number }, glide: AnchorGlide,
  landing: AdventureLanding, dt: number) => {
  const seconds = glideSeconds(glide, landing);
  glide.elapsed = Math.min(seconds, glide.elapsed + dt);
  const share = glide.elapsed / seconds, eased = share * share * (3 - 2 * share);
  const x = glide.x + (landing.water.x - glide.x) * eased, z = glide.z + (landing.water.z - glide.z) * eased;
  const step = DMath.hypot(x - ship.x, z - ship.z);
  Object.assign(ship, { speed: dt > 0 ? step / dt : 0, x, yaw: glide.yaw + turnBetween(glide.yaw, landing.yaw) * eased,
    z });
  return share >= 1;
};

/** Whether a saved glide is well formed. */
export const anchorGlideError = (glide: AnchorGlide | undefined) => glide !== undefined &&
  !(glide && typeof glide === "object" && [glide.elapsed, glide.x, glide.yaw, glide.z].every(Number.isFinite) &&
    glide.elapsed >= 0);
