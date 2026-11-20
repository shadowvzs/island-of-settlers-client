import type { ShipFrame, ShipSiteFrame } from "../../render-common/ships/ship-frame";
import { DMath } from "../math/deterministic-math";
import { createCorridorReach } from "./military-long-routes";
import { militaryGroundPath } from "./military-routing";
import type { MilitaryOrder } from "./military-targeting";
import { NO_BUILDING } from "./settlement-home";
import { rideOverBeach } from "./settlement-landing-beach";
import {
  ADVENTURE_ABOARD, ADVENTURE_BEACH, ADVENTURE_GANGWAY, ADVENTURE_LANDING_PHASES, ADVENTURE_SHIP_PHASES,
  createLandingDeck, hasSetOff, RIDING_PACE, stepOnGangway
} from "./settlement-landing-deck";
import type { createSettlementMilitary, EmigratedTroop } from "./settlement-military";
import { findGroundPath, isMountedNavigationClear } from "./settlement-navigation";
import { groundPath, setActorPath } from "./settlement-paths";
import { createSeaMask, findCoastalWorkSite, SHIPYARD_RADIUS } from "./settlement-sea-navigation";
import {
  advanceShipPier, findShipWorkpoint, type HullSpan, type ShipWorkpoint, workpointYaw
} from "./settlement-ship-workpoint";
import { createTransientMap } from "./settlement-transient-state";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

export {
  ADVENTURE_ABOARD, ADVENTURE_BEACH, ADVENTURE_GANGWAY, ADVENTURE_LANDING_PHASES, ADVENTURE_SHIP_PHASES
} from "./settlement-landing-deck";

/** Stable infantry order followed by cavalry: horses never get ahead of troops still aboard. */
export const cavalryLastLandingOrder = <T>(entries: readonly T[], typeOf: (entry: T) => string | undefined) => {
  const infantry: T[] = [], cavalry: T[] = [];
  for (const entry of entries) (typeOf(entry) === "cavalry" ? cavalry : infantry).push(entry);
  return [...infantry, ...cavalry];
};

/** Repairs aboard turns; soldiers already walking the gangway keep their position and turn. */
export const createLandingQueue = (
  actors: readonly SettlementActor[], typeOf: (actor: SettlementActor) => string | undefined
) => {
  const waiting = actors.filter(actor => actor.phase === ADVENTURE_ABOARD)
    .sort((a, b) => a.timer - b.timer || a.uid - b.uid);
  const turns = waiting.map(actor => actor.timer);
  const ordered = cavalryLastLandingOrder(waiting, typeOf);
  ordered.forEach((actor, index) => { actor.timer = turns[index]!; });
  let cursor = 0;
  return {
    canAdvance: (actor: SettlementActor, dt: number) => {
      if (actor.phase !== ADVENTURE_ABOARD || ordered[cursor] === actor) return true;
      actor.timer -= dt;
      return false;
    },
    departed: (actor: SettlementActor) => {
      if (ordered[cursor] === actor && actor.phase !== ADVENTURE_ABOARD) cursor++;
    },
    /** The next soldier to set off from the deck (or from below it), in landing order. */
    next: () => ordered.find(actor => actor.phase === ADVENTURE_ABOARD && !hasSetOff(actor))
  };
};

/** The anchored landing ship, its gangway (a shipwright work pier) and how many soldiers are ashore. */
export interface AdventureLanding {
  water: SettlementPoint;
  yaw: number;
  gangway: ShipWorkpoint;
  ashore: number;
}

const isPoint = (value: unknown): value is SettlementPoint => Boolean(value) &&
  Number.isFinite((value as SettlementPoint).x) && Number.isFinite((value as SettlementPoint).z);

/** A saved landing: anchorage, gangway geometry and the number of soldiers already ashore. */
export const adventureLandingError = (landing: AdventureLanding | undefined) => {
  if (landing === undefined) return false;
  const gangway = landing?.gangway;
  return !landing || !isPoint(landing.water) || !Number.isFinite(landing.yaw) || !gangway ||
    ![gangway.shore, gangway.point, gangway.contact].every(isPoint) ||
    !Number.isFinite(gangway.y) || !Number.isFinite(gangway.shoreY) ||
    !Number.isSafeInteger(landing.ashore) || landing.ashore < 0;
};

/** Visual only: far above fleet ship ids and harbour dock ids. */
const LANDING_SHIP_ID = 1_900_000;
/** The first soldier steps out after the gangway is down; the others follow at this interval. */
const FIRST_STEP_SECONDS = 1;
const GANGWAY_INTERVAL_SECONDS = .8;
/** Coast searches: near the island's start clearing first, then anywhere on the island. */
const SEARCH_RADII = [SHIPYARD_RADIUS, 96];
const ANCHORAGE_ATTEMPTS = 8;
/** Soldiers gather this many cells inland from the gangway foot. */
const GATHER_MIN_STEPS = 6;
/** Leave room for a mounted soldier and the next arrivals to pass each gathering place. */
const GATHER_SPACING = 2.6;
/** Riders gather this far apart, so that another rider can mostly ride between two of them (tiles). */
const RIDERS_GATHER_SPACING = 3.8;
/** A rider riding over the beach keeps this far from the gathering places taken where he can (tiles). */
const RIDER_PASSING = 1.6;
/** A soldier off the landing ship: riding over the beach, or on his way to (or at) his gathering place. */
const ASHORE_PHASES = [ADVENTURE_BEACH, "militaryField", "militaryLeaving"];
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

type Military = Pick<ReturnType<typeof createSettlementMilitary>,
  "combat" | "immigrateAboard" | "orders" | "soldiers" | "troopType">;

/**
 * One radius: anchorages nearest `origin` first; the first whose gangway reaches dry land that
 * `accepts` (by default any). Troop ships landing at a clicked coast search a small radius with it.
 */
export const findLandingWithin = (context: SettlementContext, sea: Uint8Array, radius: number, origin: SettlementPoint,
  accepts: (landing: AdventureLanding) => boolean, hullSpan?: HullSpan) => {
  const reserved = new Set<string>();
  for (let attempt = 0; attempt < ANCHORAGE_ATTEMPTS; attempt++) {
    const coast = findCoastalWorkSite(context, { access: origin }, sea, reserved, radius);
    if (!coast) return null;
    // A hull span (troop ships) also anchors the hull on the heading its gangway was fitted to.
    const gangway = hullSpan ? findShipWorkpoint(context, { access: coast.land }, coast, 12, 36, Infinity,
      undefined, false, hullSpan) : findShipWorkpoint(context, { access: coast.land }, coast);
    const yaw = hullSpan ? workpointYaw(coast) : coast.yaw ?? 0;
    const landing = gangway && { ashore: 0, gangway, water: coast.water, yaw };
    if (landing && accepts(landing)) return landing;
    reserved.add(`${coast.water.x},${coast.water.z}`);
  }
  return null;
};

/** An anchorage and gangway on the coast nearest `origin` whose landing `accepts` (searched near first). */
export const findLandingNear = (context: SettlementContext, origin: SettlementPoint,
  accepts: (landing: AdventureLanding) => boolean = () => true): AdventureLanding | null => {
  const sea = createSeaMask(context.options.world);
  for (const radius of SEARCH_RADII) {
    const landing = findLandingWithin(context, sea, radius, origin, accepts);
    if (landing) return landing;
  }
  return null;
};

/** Where an adventure's troops come ashore: the coast nearest the island's start clearing. */
export const findAdventureLanding = (context: SettlementContext): AdventureLanding | null =>
  findLandingNear(context, context.options.world.start);

interface GatheringSearch {
  revision: string;
  search: Generator<SettlementPoint>;
  slots: SettlementPoint[];
}
const gatheringSearches = createTransientMap<Map<string, GatheringSearch>>();

/** Search lazily: each landing computes its shared, reachable gathering places only once. */
/**
 * Room for a horse here and this far round it (tiles): a gathering place is never in a narrow way, where
 * the soldier standing at it would shut riders out (owner, 2026-10-15: riders ride on off the beach).
 */
const OPEN_GROUND_REACH = 1.3;
const OPEN_GROUND_SIDES = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const isOpenGround = (context: SettlementContext, centre: SettlementPoint) => OPEN_GROUND_SIDES.every(([dx, dz]) =>
  isMountedNavigationClear(context, { x: centre.x + dx * OPEN_GROUND_REACH, z: centre.z + dz * OPEN_GROUND_REACH }));

const gatheringPlaces = function* (context: SettlementContext, shore: SettlementPoint,
  mountedOrigin?: SettlementPoint): Generator<SettlementPoint> {
  const { world } = context.options, width = world.cellsX;
  const first = Math.floor(shore.z) * width + Math.floor(shore.x);
  const steps = new Map([[first, 0]]), queue = [first];
  const slots: SettlementPoint[] = [];
  const mountedReach = mountedOrigin && createCorridorReach(context, mountedOrigin);
  const spacing = mountedOrigin ? RIDERS_GATHER_SPACING : GATHER_SPACING;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor]!, x = cell % width, z = (cell - x) / width, step = steps.get(cell)!;
    const centre = { x: x + .5, z: z + .5 };
    if (step >= GATHER_MIN_STEPS && DMath.hypot(centre.x - shore.x, centre.z - shore.z) >= GATHER_MIN_STEPS &&
      isOpenGround(context, centre) &&
      slots.every(slot => DMath.hypot(slot.x - centre.x, slot.z - centre.z) >= spacing) &&
      (!mountedReach || mountedReach(centre, true)) &&
      groundPath(context, shore, centre) &&
      (!mountedOrigin || militaryGroundPath(context, mountedOrigin, centre, true))) {
      slots.push(centre);
      yield centre;
    }
    for (const [dx, dz] of NEIGHBOURS) {
      const nx = x + dx, nz = z + dz, next = nz * width + nx;
      if (nx < 0 || nz < 0 || nx >= width || nz >= world.cellsZ || steps.has(next)) continue;
      if (!world.walkCost[next] || context.occupied[next] === 1) continue;
      steps.set(next, step + 1);
      queue.push(next);
    }
  }
};

/** The `index`-th spaced, physically reachable gathering place, clear of the shore exit. */
export const gatherSlot = (
  context: SettlementContext, shore: SettlementPoint, index: number, mounted = false
): SettlementPoint => {
  let searches = gatheringSearches.get(context);
  if (!searches) { searches = new Map(); gatheringSearches.set(context, searches); }
  const key = `${shore.x},${shore.z}:${mounted}`;
  const revision = `${context.navigationRevision ?? 0}:${context.options.world.buildRevision ?? 0}`;
  let entry = searches.get(key);
  if (!entry || entry.revision !== revision) {
    const mountedOrigin = mounted ? gatherSlot(context, shore, 0) : undefined;
    entry = { revision, search: gatheringPlaces(context, shore, mountedOrigin), slots: [] };
    searches.set(key, entry);
  }
  while (entry.slots.length <= index) {
    const next = entry.search.next();
    if (next.done) return entry.slots.at(-1) ?? shore;
    entry.slots.push(next.value);
  }
  return entry.slots[index]!;
};

/** The gathering places of the soldiers ashore (where they stand, or the end of their way there). */
const takenPlaces = (context: SettlementContext, actor: SettlementActor) => context.actors.flatMap(other =>
  other !== actor && other.job === "Soldier" && other.visible && ASHORE_PHASES.includes(other.phase)
    ? [other.path.at(-1) ?? other] : []);

/** Over the beach on foot, clear of the gathering places taken where it can (a rider is wide). */
const wayOverBeach = (context: SettlementContext, actor: SettlementActor, slot: SettlementPoint,
  taken: readonly SettlementPoint[]) => {
  const pastTaken = (point: SettlementPoint) =>
    taken.some(place => DMath.hypot(place.x - point.x, place.z - point.z) < RIDER_PASSING);
  return findGroundPath(context, actor, slot, pastTaken) ?? groundPath(context, actor, slot);
};

/**
 * The way from the gangway foot to a gathering place. A rider who rode down rides on (owner,
 * 2026-10-15): along a horse's way where there is one, else over the beach along the way on foot.
 */
const gatherWay = (context: SettlementContext, actor: SettlementActor, slot: SettlementPoint,
  taken: readonly SettlementPoint[]) => {
  const riding = actor.mounted && militaryGroundPath(context, actor, slot, true);
  if (riding) return { path: riding, phase: "militaryLeaving" };
  if (actor.mounted) {
    const beach = wayOverBeach(context, actor, slot, taken);
    return beach && { path: beach, phase: ADVENTURE_BEACH };
  }
  const walking = groundPath(context, actor, slot);
  return walking && { path: walking, phase: "militaryLeaving" };
};

/** The first gathering place from the `first`-th on that nobody takes and `actor` has a way to. */
const freeGatherPlace = (context: SettlementContext, landing: AdventureLanding, actor: SettlementActor,
  first: number, cavalry: boolean) => {
  const taken = takenPlaces(context, actor);
  for (let offset = 0; offset < 64; offset++) {
    const slot = gatherSlot(context, landing.gangway.shore, first + offset, cavalry);
    if (taken.some(place => DMath.hypot(place.x - slot.x, place.z - slot.z) < GATHER_SPACING)) continue;
    const way = gatherWay(context, actor, slot, taken);
    if (way) return { slot, way };
  }
  return null;
};

/**
 * One tick of a soldier landing from an anchored ship: waiting aboard for its turn, then down the
 * gangway and inland to its gathering cell, where it becomes a field soldier.
 */
export const advanceLandingSoldier = (
  context: SettlementContext, landing: AdventureLanding, actor: SettlementActor, dt: number,
  cavalryIndex?: number
) => {
  if (actor.phase === ADVENTURE_ABOARD) {
    actor.timer -= dt;
    // Soldiers standing on deck (visible since 2026-10-15) do not hold the gangway.
    if (actor.timer <= 0 && !context.actors.some(other => other !== actor && other.visible &&
      other.phase !== ADVENTURE_ABOARD &&
      DMath.hypot(other.x - landing.gangway.point.x, other.z - landing.gangway.point.z) < .6))
      stepOnGangway(actor, landing.gangway);
    return;
  }
  if (actor.phase === ADVENTURE_BEACH) return rideOverBeach(context, actor, dt);
  if (!advanceShipPier(context, actor, landing.gangway, true, dt, actor.mounted ? RIDING_PACE : undefined)) return;
  const place = freeGatherPlace(context, landing, actor, cavalryIndex ?? landing.ashore, cavalryIndex !== undefined);
  if (!place) return;
  landing.ashore++;
  setActorPath(actor, place.way.path, place.way.phase);
};

/** Seconds before the `index`-th soldier aboard steps onto the gangway. */
export const gangwayTurn = (index: number) => FIRST_STEP_SECONDS + index * GANGWAY_INTERVAL_SECONDS;

/**
 * Adventure landing: an own ship anchors off a quiet beach, puts out a gangway (the shipwright
 * work pier) and the troops cross the deck and walk down it two at a time, then gather inland. The
 * ship stays anchored as the visible return point; it is visual only and never joins the fleet.
 */
export const createAdventureLanding = (context: SettlementContext, military: Military) => {
  let landing: AdventureLanding | undefined;
  const restoredDepartures = new Map<number, SettlementActor["path"]>();
  const restoredDestinations = new Map<number, { point: SettlementPoint; order?: MilitaryOrder }>();
  let restoredGatherIndex = 0;
  let restoredCavalryIndex = 0;
  let cavalryAshore = 0;
  let queue = createLandingQueue([], actor => military.troopType(actor.uid));
  const deck = createLandingDeck(context, uid => military.troopType(uid));
  /** Riders' horses by rider (the hidden horse actors). */
  const mounts = () => new Map(military.soldiers().flatMap(soldier =>
    soldier.combat?.mount === undefined ? [] : [[soldier.actor, soldier.combat.mount] as const]));
  const start = (plan: AdventureLanding, troops: readonly EmigratedTroop[]) => {
    restoredDepartures.clear();
    restoredDestinations.clear();
    cavalryAshore = 0;
    landing = { ...plan, ashore: 0 };
    const head = { ...plan.gangway.point, y: plan.gangway.y };
    const actors = military.immigrateAboard(cavalryLastLandingOrder(troops, troop => troop.type),
      head, ADVENTURE_ABOARD);
    actors.forEach((actor, index) => {
      actor.timer = gangwayTurn(index);
    });
    queue = createLandingQueue(actors, actor => military.troopType(actor.uid));
    deck.arrange(landing, { ashore: [], footAshore: 0, mounts: mounts(), ordered: actors, ridersAshore: 0 });
    for (const actor of actors) deck.stand(landing, actor);
  };
  /** Soldiers ashore marching to a cancelled banner go back to a free gathering place on the beach. */
  military.orders.onRallyStranded(ids => {
    if (!landing) return;
    for (const id of ids) {
      const actor = context.actors.find(entry => entry.uid === id);
      if (!actor || actor.home !== NO_BUILDING) continue;
      const place = freeGatherPlace(context, landing, actor, 0, military.troopType(id) === "cavalry");
      if (place) military.combat.command([id], place.slot, "move");
    }
  });
  /** A soldier leaving for his gathering place joins the rally point's gathering. */
  const gatherOnceLeaving = (actor: SettlementActor) => {
    if (actor.phase === "militaryLeaving" && military.orders.rally()) military.orders.gather([actor.uid]);
  };
  const updateActor = (actor: SettlementActor, dt: number) => {
    const restoredPath = restoredDepartures.get(actor.uid);
    const restoredDestination = restoredDestinations.get(actor.uid);
    restoredDepartures.delete(actor.uid);
    restoredDestinations.delete(actor.uid);
    if (landing && restoredPath === actor.path) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const cavalry = military.troopType(actor.uid) === "cavalry";
        const index = cavalry ? restoredCavalryIndex++ : restoredGatherIndex++;
        const slot = gatherSlot(context, landing.gangway.shore, index, cavalry);
        const destination = restoredDestination?.point ?? military.orders.rally();
        military.combat.prepareLandingDeparture(actor, destination ?? slot);
        const path = militaryGroundPath(context, actor, slot, Boolean(actor.mounted));
        if (!path) continue;
        setActorPath(actor, path, "militaryLeaving");
        if (restoredDestination)
          military.combat.command([actor.uid], restoredDestination.point, restoredDestination.order);
        else if (military.orders.rally()) military.orders.gather([actor.uid]);
        break;
      }
    }
    deck.carryHorse(actor);
    if (!landing || !ADVENTURE_LANDING_PHASES.includes(actor.phase)) return false;
    if (actor.phase === ADVENTURE_ABOARD) {
      deck.update(landing, actor, queue.next() === actor, dt);
      return true;
    }
    if (actor.phase === ADVENTURE_BEACH) {
      advanceLandingSoldier(context, landing, actor, dt);
      gatherOnceLeaving(actor);
      return true;
    }
    if (!deck.keepsFile(landing, actor)) {
      actor.action = "idle";
      return true;
    }
    const cavalryIndex = military.troopType(actor.uid) === "cavalry" ? cavalryAshore : undefined;
    advanceLandingSoldier(context, landing, actor, dt, cavalryIndex);
    if (actor.phase === ADVENTURE_GANGWAY) return true;
    deck.landed(actor);
    if (cavalryIndex !== undefined) cavalryAshore++;
    gatherOnceLeaving(actor);
    return true;
  };
  const shipFrames = (): ShipFrame[] => landing ? [{ cargoCount: 0, id: LANDING_SHIP_ID, phase: "idle",
    x: landing.water.x, y: context.options.world.seaLevel, yaw: landing.yaw, z: landing.water.z }] : [];
  const sites = (): ShipSiteFrame[] => landing ? [{ id: LANDING_SHIP_ID, kind: "dock", progress: 1,
    workPier: landing.gangway, x: landing.water.x, y: context.options.world.seaLevel, yaw: landing.yaw,
    z: landing.water.z }] : [];
  return {
    save: () => landing && structuredClone(landing),
    restore: (saved?: AdventureLanding) => {
      landing = saved && structuredClone(saved);
      restoredDepartures.clear();
      restoredDestinations.clear();
      restoredGatherIndex = 0;
      restoredCavalryIndex = 0;
      cavalryAshore = 0;
      if (!landing) return;
      const soldiers = new Map(military.soldiers().map(soldier => [soldier.actor, soldier]));
      queue = createLandingQueue(context.actors.filter(actor => soldiers.get(actor.uid)?.combat?.faction === 0),
        actor => soldiers.get(actor.uid)?.combat?.type);
      const ordered = context.actors.filter(actor => soldiers.get(actor.uid)?.combat?.faction === 0 &&
        ADVENTURE_SHIP_PHASES.includes(actor.phase)).sort((a, b) => a.uid - b.uid);
      const ashore = context.actors.filter(actor => actor.home === -1 &&
        !ADVENTURE_SHIP_PHASES.includes(actor.phase) && soldiers.get(actor.uid)?.combat?.faction === 0);
      const ridersAshore = ashore.filter(actor => soldiers.get(actor.uid)?.combat?.type === "cavalry").length;
      deck.arrange(landing, { ashore, footAshore: Math.max(0, landing.ashore - ridersAshore), mounts: mounts(),
        ordered, ridersAshore });
      for (const actor of context.actors) {
        const state = soldiers.get(actor.uid)?.combat;
        if (!state || state.faction !== 0 || actor.home !== -1) continue;
        if (state.type === "cavalry" && !ADVENTURE_SHIP_PHASES.includes(actor.phase)) cavalryAshore++;
        const idleAtExit = actor.phase === "militaryField" && actor.mounted && !state.destination &&
          state.target === undefined && actor.action === "idle" &&
          DMath.hypot(actor.x - landing.gangway.shore.x, actor.z - landing.gangway.shore.z) < GATHER_MIN_STEPS;
        if (actor.phase === "militaryLeaving" || idleAtExit) {
          restoredDepartures.set(actor.uid, actor.path);
          if (state.destination)
            restoredDestinations.set(actor.uid, { order: state.order, point: state.destination });
        }
      }
    },
    /** Riders' horses standing on the anchored ship's deck. */
    horseFrames: () => landing ? deck.horseFrames() : [],
    shipFrames,
    sites,
    snapshot: () => landing && { shore: { ...landing.gangway.shore }, water: { ...landing.water } },
    start,
    updateActor
  };
};
