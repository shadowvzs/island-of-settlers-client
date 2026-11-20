import { BUILDING_LEVEL_STEPS } from "../balance/building-levels";
import { DMath } from "../math/deterministic-math";

/**
 * Dock porters carry a ship's ware boxes one at a time between the harbour door and the ship's side,
 * over the pier (owner, 2026-10-14): loading, a box is on the deck once its porter has set it down
 * there; unloading, it leaves the deck when a porter lifts it. Everything follows from the plan and
 * the seconds since the work began, so a save only needs the ship's timer.
 *
 * A porter's trip: a pause at the door (lifting or setting down a box), the walk out, a pause at the
 * ship and the walk back. Loading it carries on the way out, unloading on the way back.
 */
export interface CargoHandling {
  boxes: number;
  porters: number;
  /** Seconds the whole job takes (never less than the ship's own loading time). */
  seconds: number;
  /** Porter speed factor of the harbour (its upgrade level); absent = 1 (level 0 and older saves). */
  speed?: number;
  /** Seconds one porter needs to walk the route one way. */
  walk: number;
  /** Boxes a porter carries per trip (two stacked for a large cargo); absent = 1. */
  perTrip?: number;
}
/** Where a porter is: `share` of the way from the door (0) to the ship (1), its heading and its load. */
export interface PorterPlace { carrying: boolean; outward: boolean; share: number }

/** Dock porters walk briskly (tiles per second). */
export const DOCK_PORTER_SPEED = 1.25;
/** More porters would crowd the pier (owner, 2026-10-15: 8 → 12). */
export const MAX_DOCK_PORTERS = 12;
/** Seconds to lift a box up or set it down. */
const HANDLE_SECONDS = .35;
/** Porter speed factor of a harbour at upgrade `level`: walking and lifting both get faster. */
/** Harbour upgrade levels and the Shipping talent's porter share add up (owner 2026-10-20). */
export const dockPorterSpeedFactor = (level = 0, talentBonus = 0) =>
  1 + BUILDING_LEVEL_STEPS.porterSpeed * Math.max(0, level) + talentBonus;
/** Walking speed of the plan's porters (tiles per second), for the plan and the drawn porters alike. */
export const porterSpeed = (plan: CargoHandling) => DOCK_PORTER_SPEED * (plan.speed ?? 1);
const handleSeconds = (plan: CargoHandling) => HANDLE_SECONDS / (plan.speed ?? 1);
/**
 * Porters set off this many seconds apart (a tile in file), so they never walk on top of one another;
 * those going out and those coming back keep to their own lane (`DOCK_PORTER_LANE`).
 */
const PORTER_STAGGER = .8;
/** Sideways offset of a porter's lane from the route's centre line, out on one side, back on the other. */
export const DOCK_PORTER_LANE = .17;
/**
 * Visible pier handling aims at about 40 s a ship (owner, 2026-10-21: a ship never blocks the berth for
 * minutes): a cargo that would take longer with one box per porter trip is carried two stacked boxes a trip.
 * 40 s is two round trips of a typical 12-tile pier route with 12 porters, so a full 33-box deck (24 boxes
 * a round) is done in two; only very long routes stay above it (a round trip itself takes longer).
 */
export const PIER_TARGET_SECONDS = 40;
/** Boxes a porter carries at most per trip (two stacked crates). */
const MAX_BOXES_PER_TRIP = 2;
/** A usual door → pier end walk, for timetables made before a berth is known (tiles). */
export const TYPICAL_PORTER_ROUTE = 12;

/** Soldiers from another island go ashore one after another this many seconds apart. */
export const TROOP_LANDING_INTERVAL = 1.6;
/** Their walking pace down the gangway and the pier (tiles per second). */
export const TROOP_LANDING_SPEED = .9;
/** Deck walk from a soldier's place to the gangway, allowed for in the landing time (tiles). */
const DECK_WALK_ALLOWANCE = 3;

/**
 * Riders land last (owner, 2026-10-15), this many seconds apart: two horses nose to tail need about
 * two tiles, the first one also behind the last man on foot.
 */
export const RIDER_LANDING_INTERVAL = 2.6;

/**
 * Seconds into the unloading at which soldier `index` sets off, in landing order: the `foot` soldiers
 * on foot first, then the riders.
 */
export const troopLandingStart = (index: number, foot: number) => {
  if (index < foot) return index * TROOP_LANDING_INTERVAL;
  const firstRider = foot > 0 ? (foot - 1) * TROOP_LANDING_INTERVAL + RIDER_LANDING_INTERVAL : 0;
  return firstRider + (index - foot) * RIDER_LANDING_INTERVAL;
};

/**
 * Seconds until `troops` soldiers (`riders` of them on horseback, landing last) have all walked ashore
 * along a route of `routeLength` tiles.
 */
export const troopLandingSeconds = (troops: number, routeLength: number, riders = 0) => troops > 0
  ? troopLandingStart(troops - 1, troops - riders) + (routeLength + DECK_WALK_ALLOWANCE) / TROOP_LANDING_SPEED
  : 0;

/**
 * Tiles soldier `index` (landing order, `foot` men on foot first) has walked ashore `elapsed` seconds
 * into the unloading; negative while still aboard.
 */
export const troopLandingDistance = (index: number, elapsed: number, foot = Infinity) =>
  (elapsed - troopLandingStart(index, foot)) * TROOP_LANDING_SPEED;

/** Length of the porters' route, door to ship (tiles). */
export const routeLength = (points: readonly { x: number; z: number }[]) => points.slice(1)
  .reduce((sum, point, index) => sum + DMath.hypot(point.x - points[index]!.x, point.z - points[index]!.z), 0);

const tripSeconds = (plan: CargoHandling) => 2 * plan.walk + 2 * handleSeconds(plan);
/** Seconds into a trip at which the porter has finished at the ship (box set down or lifted). */
const doneAtShip = (plan: CargoHandling) => 2 * handleSeconds(plan) + plan.walk;

/** The porters' job; `speed` is the harbour's porter factor (`dockPorterSpeedFactor`), 1 at level 0. */
export const planCargoHandling = (
  boxes: number, routeLength: number, minimumSeconds: number, speed = 1
): CargoHandling => {
  const faster = speed !== 1 ? { speed } : {};
  const walk = Math.max(0, routeLength) / (DOCK_PORTER_SPEED * speed);
  if (boxes <= 0) return { boxes: 0, porters: 0, seconds: minimumSeconds, walk, ...faster };
  const timed = (perTrip: number) => {
    const porters = Math.min(MAX_DOCK_PORTERS, Math.ceil(boxes / perTrip));
    const rounds = Math.ceil(boxes / (porters * perTrip)), stacked = perTrip > 1 ? { perTrip } : {};
    const plan = { boxes, porters, seconds: 0, walk, ...faster, ...stacked };
    return { ...plan, seconds: Math.max(minimumSeconds, rounds * tripSeconds(plan) + (porters - 1) * PORTER_STAGGER) };
  };
  const single = timed(1);
  return single.seconds > PIER_TARGET_SECONDS && boxes > MAX_DOCK_PORTERS ? timed(MAX_BOXES_PER_TRIP) : single;
};

const perTrip = (plan: CargoHandling) => plan.perTrip ?? 1;
/** Trips porter `porter` makes: the trips (of `perTrip` boxes, the last with the rest) are shared out in turn. */
const tripsOf = (plan: CargoHandling, porter: number) =>
  Math.max(0, Math.ceil((Math.ceil(plan.boxes / perTrip(plan)) - porter) / Math.max(1, plan.porters)));
/** Boxes of trip `trip` (in the order they are shared out). */
const tripBoxes = (plan: CargoHandling, trip: number) =>
  Math.max(0, Math.min(perTrip(plan), plan.boxes - trip * perTrip(plan)));
/** Boxes porter `porter` has moved after `trips` of its trips. */
const boxesAfter = (plan: CargoHandling, porter: number, trips: number) => {
  let boxes = 0;
  for (let trip = 0; trip < trips; trip++) boxes += tripBoxes(plan, porter + trip * plan.porters);
  return boxes;
};

/** Boxes on the deck `elapsed` seconds into the job. */
export const deckBoxesAt = (plan: CargoHandling, elapsed: number, unloading: boolean) => {
  let moved = 0;
  for (let porter = 0; porter < plan.porters; porter++) {
    const time = elapsed - porter * PORTER_STAGGER - doneAtShip(plan);
    if (time >= 0)
      moved += boxesAfter(plan, porter, Math.min(tripsOf(plan, porter), Math.floor(time / tripSeconds(plan)) + 1));
  }
  return unloading ? plan.boxes - moved : moved;
};

/**
 * Boxes that have reached the harbour's storage (unloading: set down at the door) or left it (loading: lifted
 * at the door) `elapsed` seconds into the job: the goods are credited or taken box by box.
 */
export const storageBoxesAt = (plan: CargoHandling, elapsed: number, unloading: boolean) => {
  let boxes = 0;
  const trip = tripSeconds(plan), lift = unloading ? trip : handleSeconds(plan);
  for (let porter = 0; porter < plan.porters; porter++) {
    const time = elapsed - porter * PORTER_STAGGER - lift;
    if (time >= 0) boxes += boxesAfter(plan, porter, Math.min(tripsOf(plan, porter), Math.floor(time / trip) + 1));
  }
  return boxes;
};

/** Where porter `porter` is `elapsed` seconds into the job; null before its first and after its last trip. */
export const porterPlaceAt = (plan: CargoHandling, porter: number, elapsed: number,
  unloading: boolean): PorterPlace | null => {
  const time = elapsed - porter * PORTER_STAGGER, trip = tripSeconds(plan);
  if (time < 0 || time >= tripsOf(plan, porter) * trip) return null;
  const handle = handleSeconds(plan), into = time % trip, out = handle + plan.walk, back = out + handle;
  const share = (walked: number) => plan.walk ? Math.min(1, Math.max(0, walked / plan.walk)) : 1;
  if (into < handle) return { carrying: !unloading, outward: true, share: 0 };
  if (into < out) return { carrying: !unloading, outward: true, share: share(into - handle) };
  if (into < back) return { carrying: unloading, outward: true, share: 1 };
  return { carrying: unloading, outward: false, share: 1 - share(into - back) };
};

/** The existing trip's manifest indices, including its optional second stacked box. Render-only. */
export const porterCargoIndices = (plan: CargoHandling, porter: number, elapsed: number) => {
  const time = elapsed - porter * PORTER_STAGGER;
  if (time < 0) return [];
  const trip = Math.floor(time / tripSeconds(plan));
  if (trip >= tripsOf(plan, porter)) return [];
  const first = (porter + trip * plan.porters) * perTrip(plan);
  return Array.from({ length: Math.min(perTrip(plan), plan.boxes - first) }, (_, index) => first + index);
};
