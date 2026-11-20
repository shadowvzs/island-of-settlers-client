import type { MovementOutcome } from "../../shared/settlement/settlement-navigation-recovery";

/**
 * Render-only waiting pose. The simulation keeps `action = "walk"` while a unit is blocked, because
 * traffic reads it as "intends to move"; the renderer stops the stride once it has stood still a moment.
 */
const BLOCKED_OUTCOMES = new Set<MovementOutcome>([
  "door-queue", "person-blocked", "static-blocked", "stock-wait", "yield-wait"
]);
const BLOCKED_POSE_DELAY = .15;
const STILL_DISTANCE = .001;

export const nextBlockedSeconds = (previous: number, outcome: MovementOutcome, moved: number, dt: number) =>
  BLOCKED_OUTCOMES.has(outcome) && moved < STILL_DISTANCE ? previous + dt : 0;

/** A walker held in a queue breathes in place instead of freezing mid-stride. */
export const blockedWalkAction = <Action extends string>(action: Action, blockedSeconds: number) =>
  action === "walk" && blockedSeconds > BLOCKED_POSE_DELAY ? "idle_breathe" : action;
