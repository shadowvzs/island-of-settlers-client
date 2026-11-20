import { DMath } from "../math/deterministic-math";
import type { SavedEntries } from "./military-field-save";
import { militaryGroundPath } from "./military-routing";
import { distanceBetween, distanceToSegment } from "./settlement-geometry";
import { groundPath, setActorPath } from "./settlement-paths";
import {
  QUEUE_DUEL_CLEARANCE, QUEUE_LANE_CLEARANCE, queueLineSlot, type SiegeSiteSlots,
  siegeStance
} from "./settlement-siege-slots";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/** A soldier this close to its stance has arrived. */
export const ARRIVAL_DISTANCE = .08;
/** A soldier stopped this close to its taken place waits there instead of searching a way again. */
const NEAR_PLACE = 1.1;
/** Seconds held beside its place before a soldier stops pressing on. */
const HELD_NEAR_PLACE = 2;
const REST_TICKS = 60;
/** A waiting soldier moves up to a freed place nearer the door only from this close (tiles). */
const QUEUE_MOVE_UP = 2.5;

/** A waiting soldier's place in a door queue; `seen`: the last tick it stood in the queue. */
interface QueuePlace { site: number; index: number; seen: number }
/** Relative to the siege tick (not saved): places by ticks since last seen, rests by ticks left. */
export interface SiegeQueueSave {
  places: SavedEntries<{ index: number; seenAgo: number; site: number }>; resting: SavedEntries<number>;
}

interface SiegeQueueMovement {
  /** Walks a soldier outside buildings one tick along its path, round the others (true once done). */
  steer: (body: SettlementActor, dt: number) => boolean;
  /** Seconds a walking soldier has been held on one spot by the bodies round it. */
  heldSeconds: (uid: number) => number;
}

/** Clear of the door duel and of the door lane: a waiting soldier may stop here. */
const keepsDoorClear = (site: SettlementBuilding, point: SettlementPoint) =>
  distanceBetween(point, siegeStance(site, .65)) >= QUEUE_DUEL_CLEARANCE &&
  distanceToSegment(point, site.workerApproach, site.access) >= QUEUE_LANE_CLEARANCE;

/** Door queue places of the waiting attackers and their walk to them; owns the siege tick counter. */
export const createSiegeQueue = (
  context: SettlementContext, battle: SiegeQueueMovement, siteSlots: (site: SettlementBuilding) => SiegeSiteSlots
) => {
  /** Waiting places by soldier: kept until it leaves the queue (saved with the siege tick). */
  const places = new Map<number, QueuePlace>();
  /** Until which tick a soldier boxed in beside its place stands before it tries again. */
  const resting = new Map<number, number>();
  let tick = 0;
  /** Starts a siege tick: forgets places nobody stood in last tick and finished rests. */
  const advance = () => {
    tick++;
    for (const [uid, place] of places) if (place.seen < tick - 1) places.delete(uid);
    for (const [uid, until] of resting) if (until < tick) resting.delete(uid);
  };
  /** Places of `site`'s queue held by other soldiers still waiting there. */
  const isTaken = (site: number, index: number, uid: number) => {
    for (const [other, place] of places)
      if (other !== uid && place.site === site && place.index === index && place.seen >= tick - 1) return true;
    return false;
  };
  const firstFree = (site: SettlementBuilding, uid: number, count: number) => {
    for (let index = 0; index < count; index++) if (!isTaken(site.uid, index, uid)) return index;
    return count;
  };
  /**
   * A waiting soldier keeps its place while it waits (places used to follow the soldier's rank in
   * the queue, so every death or departure sent the whole queue walking round each other). A
   * newcomer takes the free place nearest the door; a waiting soldier moves up only to a freed
   * place close by.
   */
  const queuePlace = (site: SettlementBuilding, body: SettlementActor) => {
    const slots = siteSlots(site).points, held = places.get(body.uid);
    const free = firstFree(site, body.uid, slots.length);
    let index = held?.site === site.uid ? held.index : free;
    const freed = slots[free];
    if (free < index && freed && distanceBetween(body, freed) <= QUEUE_MOVE_UP) index = free;
    if (held?.site === site.uid && held.index !== index && isTaken(site.uid, index, body.uid)) index = held.index;
    places.set(body.uid, { index, seen: tick, site: site.uid });
    return slots[Math.min(index, slots.length - 1)] ?? queueLineSlot(site, index);
  };
  /** Walks a soldier to `point` (`queue`: a waiting place of `site`'s queue); true once it stands there. */
  const walkTo = (body: SettlementActor, point: SettlementPoint, dt: number, queue?: SettlementBuilding) => {
    // Asked to make way (a comrade on its way to the door fight): it steps aside first.
    if (body.queueTarget) { battle.steer(body, dt); return false; }
    if (DMath.hypot(body.x - point.x, body.z - point.z) <= ARRIVAL_DISTANCE) {
      body.action = "idle"; body.path = []; body.pathIndex = 0;
      return true;
    }
    // A new place (moved up in the queue, a flank) replaces the way to the old one; a queued soldier
    // that stopped beside its place (someone else stands on it) waits there, off the door's way.
    const goal = body.path.at(-1), near = distanceBetween(body, point) <= NEAR_PLACE;
    const waitsNear = queue !== undefined && near && keepsDoorClear(queue, body);
    // Boxed in by comrades right beside its place (a flank or queue place): it stands a while instead
    // of pressing against them, then tries again.
    if ((resting.get(body.uid) ?? 0) > tick) return false;
    if (near && battle.heldSeconds(body.uid) >= HELD_NEAR_PLACE) {
      body.action = "idle"; body.path = []; body.pathIndex = 0; resting.set(body.uid, tick + REST_TICKS);
      return false;
    }
    if (!goal || distanceBetween(goal, point) > ARRIVAL_DISTANCE ||
      (body.pathIndex >= body.path.length && !waitsNear)) {
      const path = groundPath(context, body, point) ?? militaryGroundPath(context, body, point);
      if (path) setActorPath(body, path, "militaryField");
    }
    battle.steer(body, dt);
    return false;
  };
  const clear = () => { places.clear(); resting.clear(); };
  const save = (): SiegeQueueSave => ({
    places: [...places].map(([uid, { index, seen, site }]) => [uid, { index, seenAgo: tick - seen, site }]),
    resting: [...resting].map(([uid, until]) => [uid, until - tick])
  });
  const restore = (saved: Partial<SiegeQueueSave> | undefined) => {
    clear();
    for (const [uid, { index, seenAgo, site }] of saved?.places ?? [])
      places.set(uid, { index, seen: tick - seenAgo, site });
    for (const [uid, left] of saved?.resting ?? []) resting.set(uid, tick + left);
  };
  return { advance, clear, queuePlace, restore, save, walkTo };
};
