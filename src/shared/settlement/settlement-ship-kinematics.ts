import { wrapAngle } from "../../render-common/wildlife/nav/nav-steering";
import { SHIP_SAILING_MULTIPLIER } from "../balance/colonies";
import { DMath } from "../math/deterministic-math";
import type { ShipTrigonometry } from "./settlement-ship-trigonometry";
import type { SettlementPoint } from "./settlement-types";

/**
 * Hull kinematics shared by every ship that moves. A hull only ever moves along its keel (ahead or
 * astern) on a circular arc, or swings round one point of its keel (oars, a spring line); it never
 * slides sideways. Speed changes at bounded acceleration and the tightest turn widens with speed.
 */
export interface ShipPose extends SettlementPoint { yaw: number }
export interface ShipMotion extends ShipPose { speed: number }

/** Full sailing speed (tiles per second). */
export const SHIP_SPEED = SHIP_SAILING_MULTIPLIER;
/** Gathering way and taking it off (tiles/s²): about 3 s from rest to full sail, under 2 s to stop. */
export const SHIP_ACCELERATION = .35 * SHIP_SAILING_MULTIPLIER * SHIP_SAILING_MULTIPLIER;
export const SHIP_DECELERATION = .6 * SHIP_SAILING_MULTIPLIER * SHIP_SAILING_MULTIPLIER;
/** Manoeuvring speed ahead and astern in tight water. */
export const SHIP_MANOEUVRE_SPEED = .55 * SHIP_SAILING_MULTIPLIER;
/** Tightest radius under way (tiles); slower ships turn tighter, helped by their oars. */
export const SHIP_TURN_RADIUS = 4;
/** Rate the oars alone swing the hull (rad/s): a full about-turn on the spot takes about 9 s. */
export const OAR_TURN_RATE = .35 * SHIP_SAILING_MULTIPLIER;
/** Absolute cap on the hull's rate of turn (rad/s). */
export const SHIP_TURN_RATE = .6 * SHIP_SAILING_MULTIPLIER;

const forward = (yaw: number, trig: ShipTrigonometry = DMath) => ({ x: trig.sin(yaw), z: trig.cos(yaw) });

/** Fastest rate of turn at `speed`: the oars (losing their grip as the ship gathers way) or the rudder. */
export const shipTurnRate = (speed: number) => Math.min(SHIP_TURN_RATE, Math.max(
  OAR_TURN_RATE * Math.max(0, 1 - Math.abs(speed) / SHIP_SPEED), Math.abs(speed) / SHIP_TURN_RADIUS));

/** Highest speed from which the hull still stops within `distance`. */
export const brakingSpeed = (distance: number) => Math.sqrt(2 * SHIP_DECELERATION * Math.max(0, distance));

/** Speed after one tick of gathering or taking off way towards `target` (signed: astern < 0). */
export const changeSpeed = (speed: number, target: number, dt: number) => {
  const slowing = Math.abs(target) < Math.abs(speed) || target * speed < 0;
  const limit = (slowing ? SHIP_DECELERATION : SHIP_ACCELERATION) * dt;
  return speed + Math.max(-limit, Math.min(limit, target - speed));
};

/**
 * Sails `distance` (negative astern) along the keel while the bow turns by `turn` radians: the
 * centre follows the exact circular arc, so the hull never moves across its keel.
 */
export const sailArc = (pose: ShipPose, distance: number, turn: number, trig: ShipTrigonometry = DMath): ShipPose => {
  const yaw = pose.yaw + turn;
  if (Math.abs(turn) < 1e-9) {
    const along = forward(pose.yaw, trig);
    return { x: pose.x + along.x * distance, yaw, z: pose.z + along.z * distance };
  }
  const radius = distance / turn;
  return { x: pose.x + radius * (trig.cos(pose.yaw) - trig.cos(yaw)), yaw: wrapAngle(yaw),
    z: pose.z + radius * (trig.sin(yaw) - trig.sin(pose.yaw)) };
};

/** The hull swung by `turn` round the keel point `offset` tiles ahead of its centre (astern < 0). */
export const swingAbout = (pose: ShipPose, offset: number, turn: number, trig: ShipTrigonometry = DMath): ShipPose => {
  const before = forward(pose.yaw, trig), yaw = wrapAngle(pose.yaw + turn), after = forward(yaw, trig);
  return { x: pose.x + (before.x - after.x) * offset, yaw, z: pose.z + (before.z - after.z) * offset };
};

/** The arc through `pose` (tangent to its keel) that ends at `target`: signed length and turn. */
export const arcTo = (pose: ShipPose, target: SettlementPoint, astern: boolean) => {
  const chord = DMath.hypot(target.x - pose.x, target.z - pose.z);
  if (chord < 1e-9) return { length: 0, turn: 0 };
  const course = DMath.atan2(target.x - pose.x, target.z - pose.z);
  const half = wrapAngle(course - pose.yaw - (astern ? Math.PI : 0));
  const length = Math.abs(half) < 1e-6 ? chord : chord * half / DMath.sin(half);
  return { length: astern ? -length : length, turn: 2 * half };
};
