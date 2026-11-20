import { WORKER_COLLISION_RADIUS } from "../../render-common/workers/worker-dimensions";
import { DMath } from "../math/deterministic-math";
import { distanceToSegment } from "./settlement-geometry";
import { isNavigationClear,isNavigationFootprintClear } from "./settlement-navigation";
import { isTrafficSegmentClear, setQueueTarget } from "./settlement-traffic";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * Waiting slots outside an owned stock court. A queued entrant walks once to a fixed spot beside
 * the court on its approach side and waits there idle, instead of re-hopping between shoulders.
 */
const COURT_MARGIN = .15;
const OUTWARD_STEPS = [.3, .55, .8, 1.05] as const;
const LATERAL_STEPS = [0, .4, -.4, .8, -.8] as const;
const SLOT_REACHED = .06;
const SLOT_SPACING = .36;
/** A waiter checks its slot once per tick; it re-picks only after about a second of obstruction. */
const REPICK_AFTER_CHECKS = 20;

interface CourtSlot { blockedChecks: number; building: number; phase: string; point: SettlementPoint }
const slots = new WeakMap<SettlementActor, CourtSlot>();

const isOutsideCourt = (building: SettlementBuilding, point: SettlementPoint) =>
  Math.abs(point.x - building.x) > building.width / 2 + COURT_MARGIN ||
  Math.abs(point.z - building.z) > building.depth / 2 + COURT_MARGIN;

/** Clips one axis of a segment against the court (Liang-Barsky); null when it misses that slab. */
const clipCourtAxis = (start: number, delta: number, half: number, range: [number, number]) => {
  if (Math.abs(delta) < 1e-9) return Math.abs(start) <= half ? range : null;
  const first = (-half - start) / delta, second = (half - start) / delta;
  const enter = Math.max(range[0], Math.min(first, second)), exit = Math.min(range[1], Math.max(first, second));
  return enter <= exit ? [enter, exit] as [number, number] : null;
};
/**
 * Whether a straight walk crosses the reserved court itself. A waiter whose body enters the court is
 * held there by the reservation (TRAFFIC-01), so a slot is only usable along a path around it.
 */
const crossesCourt = (building: SettlementBuilding, from: SettlementPoint, to: SettlementPoint) => {
  const alongX = clipCourtAxis(from.x - building.x, to.x - from.x, building.width / 2, [0, 1]);
  return !!alongX && !!clipCourtAxis(from.z - building.z, to.z - from.z, building.depth / 2, alongX);
};

/** The plot side the contact faces, as a unit axis pointing out of the court. */
const outwardAxis = (building: SettlementBuilding, contact: SettlementPoint) => {
  const dx = (contact.x - building.x) / building.width, dz = (contact.z - building.z) / building.depth;
  return Math.abs(dx) >= Math.abs(dz) ? { x: Math.sign(dx) || 1, z: 0 } : { x: 0, z: Math.sign(dz) || 1 };
};

/** Where the edge of the court meets the line out from the contact, on that side. */
const edgePoint = (building: SettlementBuilding, contact: SettlementPoint, axis: SettlementPoint) => ({
  x: axis.x ? building.x + axis.x * (building.width / 2 + COURT_MARGIN) : contact.x,
  z: axis.z ? building.z + axis.z * (building.depth / 2 + COURT_MARGIN) : contact.z
});

const isSlotTaken = (context: SettlementContext, actor: SettlementActor, point: SettlementPoint) =>
  context.actors.some(other => {
    if (other === actor) return false;
    const held = slots.get(other);
    if (held && held.phase === other.phase && DMath.hypot(held.point.x - point.x, held.point.z - point.z) < SLOT_SPACING)
      return true;
    return other.visible && DMath.hypot(other.x - point.x, other.z - point.z) < SLOT_SPACING && !slots.has(other);
  });

/** The court owner's current and next leg: no waiter may stand in it. */
const OWNER_CORRIDOR = .32;
export const isInOwnerCorridor = (owner: SettlementActor, point: SettlementPoint) => {
  const next = owner.queueTarget ?? owner.path[owner.pathIndex];
  if (!next) return false;
  if (distanceToSegment(point, owner, next) < OWNER_CORRIDOR) return true;
  const following = owner.queueTarget ? undefined : owner.path[owner.pathIndex + 1];
  return Boolean(following && distanceToSegment(point, next, following) < OWNER_CORRIDOR);
};
const isSlotUsable = (
  context: SettlementContext, actor: SettlementActor, owner: SettlementActor, point: SettlementPoint
) =>
  !isInOwnerCorridor(owner, point) && isNavigationClear(context, point) &&
  isNavigationFootprintClear(context, point, () => false, WORKER_COLLISION_RADIUS) &&
  !isSlotTaken(context, actor, point);

/** Fixed candidate spots, nearest to the contact first. */
const slotCandidates = (building: SettlementBuilding, contact: SettlementPoint) => {
  const axis = outwardAxis(building, contact);
  const edge = edgePoint(building, contact, axis);
  return OUTWARD_STEPS.flatMap(outward => LATERAL_STEPS.map(lateral => ({
    x: edge.x + axis.x * outward - axis.z * lateral, z: edge.z + axis.z * outward + axis.x * lateral
  }))).filter(point => isOutsideCourt(building, point));
};
/** The nearest usable slot the waiter can walk to without pushing through other people. */
const pickSlot = (context: SettlementContext, actor: SettlementActor, owner: SettlementActor,
  building: SettlementBuilding, contact: SettlementPoint) => {
  const usable = slotCandidates(building, contact).filter(point => !crossesCourt(building, actor, point) &&
    isSlotUsable(context, actor, owner, point));
  return usable.find(point => isTrafficSegmentClear(context, actor, point, true)) ?? usable[0];
};

const isCurrent = (slot: CourtSlot, actor: SettlementActor, building: SettlementBuilding) =>
  slot.building === building.uid && slot.phase === actor.phase && actor.stockBuilding === building.uid;

/** Just past the court edge, so the stepped-out waiter no longer stands in the reserved court. */
const EXIT_CLEARANCE = COURT_MARGIN + .05;
const exits = new WeakMap<SettlementActor, SettlementPoint>();

export const releaseCourtSlot = (actor: SettlementActor) => {
  slots.delete(actor);
  exits.delete(actor);
};

/** The nearest points straight out of the court across each edge, nearest first. */
const courtExitCandidates = (building: SettlementBuilding, actor: SettlementActor) => {
  const halfX = building.width / 2 + EXIT_CLEARANCE, halfZ = building.depth / 2 + EXIT_CLEARANCE;
  return [
    { x: building.x - halfX, z: actor.z }, { x: building.x + halfX, z: actor.z },
    { x: actor.x, z: building.z - halfZ }, { x: actor.x, z: building.z + halfZ }
  ].sort((a, b) => DMath.hypot(a.x - actor.x, a.z - actor.z) - DMath.hypot(b.x - actor.x, b.z - actor.z));
};
const isWalkingOut = (actor: SettlementActor) => {
  const exit = exits.get(actor);
  return !!exit && actor.queueKind === "court-slot" && actor.queueTarget === exit;
};
/**
 * A queued entrant standing inside another crew's court (pushed in, or released by the watchdog)
 * steps straight out across the nearest walkable edge instead of freezing in the owner's way.
 * Returns whether the current step is that walk out.
 */
export const stepOutOfCourt = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding) => {
  if (isWalkingOut(actor)) return true;
  slots.delete(actor);
  const exit = courtExitCandidates(building, actor).find(point => isNavigationClear(context, point) &&
    isTrafficSegmentClear(context, actor, point));
  if (!exit) return false;
  exits.set(actor, exit);
  setQueueTarget(actor, exit, "court-slot");
  return false;
};

/**
 * Sends a queued entrant to its waiting slot (no pause on arrival) and keeps it there. Returns
 * false when no slot is free, so the caller can fall back to a plain shoulder.
 */
export const waitAtCourtSlot = (context: SettlementContext, actor: SettlementActor, owner: SettlementActor,
  building: SettlementBuilding, contact: SettlementPoint) => {
  let slot = slots.get(actor);
  if (slot && !isCurrent(slot, actor, building)) slot = undefined;
  if (slot) slot.blockedChecks = isSlotUsable(context, actor, owner, slot.point) ? 0 : slot.blockedChecks + 1;
  // The owner's way in or out is cleared at once; other obstructions get a second to pass.
  const inOwnerWay = slot && isInOwnerCorridor(owner, slot.point);
  if (!slot || inOwnerWay || slot.blockedChecks >= REPICK_AFTER_CHECKS) {
    const point = pickSlot(context, actor, owner, building, contact);
    if (!point) { slots.delete(actor); return false; }
    slot = { blockedChecks: 0, building: building.uid, phase: actor.phase, point };
    slots.set(actor, slot);
  }
  const { point } = slot;
  if (DMath.hypot(actor.x - point.x, actor.z - point.z) <= SLOT_REACHED) return true;
  const queued = actor.queueTarget;
  if (!queued || DMath.hypot(queued.x - point.x, queued.z - point.z) > 1e-6) setQueueTarget(actor, point, "court-slot");
  return true;
};
