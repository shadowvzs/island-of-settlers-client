import {
  loadCarryGroundSpeed,
  RUN_DURATION,
  RUN_GROUND_SPEED,
  WALK_DURATION,
  WALK_GROUND_SPEED
} from "@workers/worker-locomotion";

import { DMath } from "../../shared/math/deterministic-math";
import { WORKER_SCALE } from "./worker-dimensions";

/**
 * Walk and run speeds (cells per second). Long trips run, short ones walk. Both move at their
 * clip's ground speed scaled by the worker size, so they play at 1x and grow with the worker
 * (about 0.62 walk at 2.2 steps/s and 1.37 run at 3.2 steps/s for a 1.06 cell tall worker).
 */
export const WALK_SPEED = WALK_GROUND_SPEED * WORKER_SCALE;
/** Loaded feet are advanced by travelled distance at their own authored ground speed. */
export const loadedCarryTimeIncrement = (action: "carry_shoulder" | "carry_back", moved: number) =>
  Math.max(0, moved) / (loadCarryGroundSpeed(action) * WORKER_SCALE);
export const RUN_SPEED = RUN_GROUND_SPEED * WORKER_SCALE;
/** A command whose route is longer than this (cells) is run. */
export const RUN_TRIP_DISTANCE = 12;
/** A running worker eases back to a walk once this little of its route remains (cells). */
export const SLOW_DOWN_DISTANCE = 3.5;
const ACCELERATION = 0.8;
const DECELERATION = 0.6;
/** Ground covered by one cycle: playback follows the ground speed, so feet never slide. */
const RUN_CYCLE_LENGTH = RUN_GROUND_SPEED * RUN_DURATION * WORKER_SCALE;
const WALK_CYCLE_LENGTH = WALK_GROUND_SPEED * WALK_DURATION * WORKER_SCALE;

export type LocomotionAction = "walk" | "run";

export const isRunTrip = (distance: number) => distance > RUN_TRIP_DISTANCE;

export const targetGaitSpeed = (runTrip: boolean, remaining: number) =>
  runTrip && remaining > SLOW_DOWN_DISTANCE ? RUN_SPEED : WALK_SPEED;

/** Speeds up gently into a run and slows down a little more gently before arriving. */
export const easeGaitSpeed = (current: number, target: number, delta: number) => {
  if (current < target) return Math.min(target, current + ACCELERATION * delta);
  return Math.max(target, current - DECELERATION * delta);
};

/**
 * A loaded worker or any carrier strides briskly but never runs (no flight phase under a log or a
 * sack; owner BAL-01): its leg blend stays below the run threshold whatever its road speed.
 */
export const LOADED_RUN_BLEND = 0.42;

/** 0 = pure walk, 1 = pure run; the Three.js crossfade weight of the run clip. */
export const runBlend = (speed: number) =>
  Math.max(0, Math.min(1, (speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED)));

/** The shared cycle phase of walk and run (left touchdown at 0) advanced by the distance
 * actually moved, so playback follows the ground speed and switching clips keeps the step. */
export const advanceGaitPhase = (phase: number, moved: number, blend: number) => {
  const cycleLength = WALK_CYCLE_LENGTH + (RUN_CYCLE_LENGTH - WALK_CYCLE_LENGTH) * blend;
  return (phase + moved / cycleLength) % 1;
};

export const locomotionAction = (blend: number): LocomotionAction =>
  blend >= 0.5 ? "run" : "walk";

export const locomotionClipTime = (action: LocomotionAction, phase: number) =>
  phase * (action === "run" ? RUN_DURATION : WALK_DURATION);

/** Route length from (x, z) through waypoints [from, count) of `path`, then on to the target
 * (a route capped at its maximum point count ends short of it). */
export const routeDistance = (
  x: number,
  z: number,
  path: Float32Array,
  from: number,
  count: number,
  target: { x: number; z: number }
) => {
  let distance = 0;
  let previousX = x;
  let previousZ = z;
  for (let index = from; index < count; index++) {
    const nextX = path[index * 2]!;
    const nextZ = path[index * 2 + 1]!;
    distance += DMath.hypot(nextX - previousX, nextZ - previousZ);
    previousX = nextX;
    previousZ = nextZ;
  }
  return distance + DMath.hypot(target.x - previousX, target.z - previousZ);
};
