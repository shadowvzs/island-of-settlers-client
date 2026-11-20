import { DMath } from "../math/deterministic-math";
import { moveActor } from "./settlement-paths";
import { forEachNearbyTrafficActor } from "./settlement-person-index";
import { isTrafficSegmentClear, setQueueTarget } from "./settlement-traffic";
import type { SettlementActor, SettlementContext, TrafficQueueKind } from "./settlement-types";

interface ShoveAnchor { clearFor: number; phase: string; x: number; yaw: number; z: number }
/** Where a pushed idler stood, so it can step back once the road beside it is quiet again. */
const anchors = new WeakMap<SettlementActor, ShoveAnchor>();
const ANCHOR_CLEARANCE = .6;
const ANCHOR_QUIET_SECONDS = .75;
/** Shoulders walked on behalf of someone else; the unit's own task timer keeps running untouched. */
const EXTERNALLY_DRIVEN_KINDS = new Set<TrafficQueueKind>(["anchor-return", "doorstep", "stationary"]);

/** Runs before the pushed unit's first step, so it records the spot it was pushed from. */
const rememberShoveAnchor = (actor: SettlementActor) => {
  if (!anchors.has(actor)) anchors.set(actor, { clearFor: 0, phase: actor.phase, x: actor.x, yaw: actor.yaw, z: actor.z });
};

const isAnchorQuiet = (context: SettlementContext, actor: SettlementActor, anchor: ShoveAnchor) =>
  !forEachNearbyTrafficActor(context, anchor, ANCHOR_CLEARANCE, other => other !== actor && other.visible &&
    DMath.hypot(other.x - anchor.x, other.z - anchor.z) < ANCHOR_CLEARANCE);

/** A pushed idler walks back to its spot after the passer has cleared it, without a pause. */
const updateShoveAnchor = (context: SettlementContext, actor: SettlementActor, dt: number) => {
  const anchor = anchors.get(actor);
  if (!anchor) return;
  if (anchor.phase !== actor.phase || actor.queueTarget || !actor.visible) {
    anchors.delete(actor);
    return;
  }
  anchor.clearFor = isAnchorQuiet(context, actor, anchor) ? anchor.clearFor + dt : 0;
  if (anchor.clearFor < ANCHOR_QUIET_SECONDS || !isTrafficSegmentClear(context, actor, anchor, true)) return;
  setQueueTarget(actor, { x: anchor.x, z: anchor.z }, "anchor-return");
};
const finishRoadShoulder = (actor: SettlementActor, kind: SettlementActor["queueKind"]) => {
  actor.queueWait = 0;
  actor.action = "idle";
  if (kind !== "anchor-return") return;
  actor.yaw = anchors.get(actor)?.yaw ?? actor.yaw;
  anchors.delete(actor);
};

/** Execute a stopped actor's shoulder motion, without consuming its work/rest timer or changing assignment. */
export const updateStationaryRoadYield = (context: SettlementContext, actor: SettlementActor, dt: number) => {
  const kind = actor.queueKind;
  if (!kind || !EXTERNALLY_DRIVEN_KINDS.has(kind)) {
    updateShoveAnchor(context, actor, dt);
    return false;
  }
  if (kind === "stationary") rememberShoveAnchor(actor);
  const timer = actor.timer;
  moveActor(context, actor, dt);
  actor.timer = timer;
  if (!actor.queueTarget) finishRoadShoulder(actor, kind);
  return true;
};
