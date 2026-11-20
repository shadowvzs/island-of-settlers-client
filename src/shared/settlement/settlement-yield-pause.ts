import { DMath } from "../math/deterministic-math";
import { isTrafficSegmentClear } from "./settlement-traffic";
import type { SettlementActor, SettlementContext } from "./settlement-types";

/** Longest pause on a reactive shoulder; it ends early once the way ahead is free. */
const REACTIVE_PAUSE = 1.2;
const MINIMUM_DWELL = .15;
/** Length of the next leg that must be free of people before the unit walks on. */
const PROBE_LENGTH = .3;
const CLEAR_TICKS_TO_RELEASE = 2;
const clearTicks = new WeakMap<SettlementActor, number>();

export const startYieldPause = (actor: SettlementActor) => {
  actor.queueWait = REACTIVE_PAUSE;
  clearTicks.delete(actor);
};

const isWayAheadClear = (context: SettlementContext, actor: SettlementActor) => {
  const point = actor.path[actor.pathIndex];
  if (!point) return true;
  const distance = DMath.hypot(point.x - actor.x, point.z - actor.z);
  if (distance < 1e-6) return true;
  const reach = Math.min(PROBE_LENGTH, distance) / distance;
  const probe = { x: actor.x + (point.x - actor.x) * reach, z: actor.z + (point.z - actor.z) * reach };
  return isTrafficSegmentClear(context, actor, probe, true);
};

/** Counts the shoulder pause down, releasing it once the next leg has been free on consecutive ticks. */
export const updateYieldPause = (context: SettlementContext, actor: SettlementActor, dt: number) => {
  actor.queueWait = Math.max(0, (actor.queueWait ?? 0) - dt);
  if (!actor.queueWait || REACTIVE_PAUSE - actor.queueWait < MINIMUM_DWELL) return;
  const clear = isWayAheadClear(context, actor) ? (clearTicks.get(actor) ?? 0) + 1 : 0;
  clearTicks.set(actor, clear);
  if (clear >= CLEAR_TICKS_TO_RELEASE) actor.queueWait = 0;
};
