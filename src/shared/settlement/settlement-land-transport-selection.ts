import { DMath } from "../math/deterministic-math";
import { STORAGE_IDS } from "./production-rules";
import type { RoadLengthField } from "./road-length-field";
import { isDoorExitQueueFull } from "./settlement-door-exit-queue";
import { footRouteEntry, footRouteFrom } from "./settlement-handcart-roads";
import {
  canPromiseWalkingCarrier, canReuseIndoorCarrier, canReuseWalkingCarrier
} from "./settlement-land-transport-reuse";
import { isGroundSegmentClear } from "./settlement-navigation";
import { actorEconomyOwnerOf, economyOwnerOf } from "./settlement-ownership";
import type {
  SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint
} from "./settlement-types";
import {
  chooseTransportForJob, preferCandidate, reuseRank, type TransportReuseCandidate
} from "./transport-reuse-policy";

export interface WalkingCarrierPickup {
  actor: SettlementActor;
  indoor?: SettlementBuilding;
  points: SettlementPoint[];
  unloading: boolean;
}

const walkingDistance = (from: SettlementPoint, path: readonly SettlementPoint[]) => {
  let previous = from, cost = 0;
  for (const point of path) {
    cost += DMath.hypot(point.x - previous.x, point.z - previous.z);
    previous = point;
  }
  return cost;
};

/**
 * Read-only building lookups for one unchanged settlement state: who staffs a building and which
 * finished storage can be a carrier's home. Exactly the first-match answers of the former scans.
 */
export interface CarrierCrewLookup {
  homes: ReadonlyMap<number, SettlementBuilding>;
  workers: ReadonlySet<number>;
}

export const createCarrierCrewLookup = (context: SettlementContext): CarrierCrewLookup => {
  const homes = new Map<number, SettlementBuilding>(), workers = new Set<number>();
  for (const building of context.buildings) {
    if (building.worker !== undefined) workers.add(building.worker);
    if (building.construction !== 1 || !STORAGE_IDS.has(building.typeId) || homes.has(building.uid)) continue;
    homes.set(building.uid, building);
  }
  return { homes, workers };
};

type WalkingCandidate = TransportReuseCandidate<WalkingCarrierPickup>;

/** A04d rollback switch: false searches every returning carrier's route, exactly the pre-A04d path. */
let lazyReturningRoutes = true;
export const setLazyReturningRoutes = (enabled: boolean) => { lazyReturningRoutes = enabled; };

/** Float slack: the field and the walked path sum the same lengths in a different order. */
const BOUND_SLACK = 1 - 1e-9;

/** A returning carrier whose route is searched only when it could still be the chosen unit. */
interface ReturningEntry {
  actor: SettlementActor;
  atSource: boolean;
  /** At most the walked length `walkingDistance` would report for its route. */
  bound: number;
  resolved?: WalkingCandidate | null;
}
type PoolEntry = WalkingCandidate | ReturningEntry;
const isReturningEntry = (entry: PoolEntry): entry is ReturningEntry => "bound" in entry;
const returningRank = (entry: ReturningEntry) => entry.atSource ? 1 : 2;

const isAtSource = (actor: SettlementActor, source: SettlementBuilding) =>
  DMath.hypot(actor.x - source.access.x, actor.z - source.access.z) <= .85;

/** The pre-A04d returning candidate: its full route search, start check and walked length. */
const searchReturning = (
  context: SettlementContext, actor: SettlementActor, source: SettlementBuilding
): WalkingCandidate | null => {
  const points = footRouteFrom(context, actor, source.access, false);
  if (!points || (points[0] && !isGroundSegmentClear(context, actor, points[0]))) return null;
  return { atSource: isAtSource(actor, source), availability: "returning", id: actor.uid,
    routeCost: walkingDistance(actor, points), value: { actor, points, unloading: false } };
};

/**
 * A returning carrier with a route, before its search: the start node gives the field bound. The
 * start check runs with the search, so a listed entry can still resolve to no candidate.
 */
const deferReturning = (
  actor: SettlementActor, source: SettlementBuilding, field: RoadLengthField
): ReturningEntry | null => {
  const entry = footRouteEntry(actor, field);
  if (!entry) return null;
  const reach = DMath.hypot(entry.node.x - actor.x, entry.node.z - actor.z);
  return { actor, atSource: isAtSource(actor, source), bound: (reach + entry.length) * BOUND_SLACK };
};

const pooledEntries = (
  context: SettlementContext, source: SettlementBuilding, allowClaim: boolean, allowReturning: boolean,
  lookup: CarrierCrewLookup, lazy: boolean
) => {
  const entries: PoolEntry[] = [];
  // Requested on the first returning carrier only: most sources have none.
  let field: RoadLengthField | null | undefined;
  const owner = economyOwnerOf(context, source);
  for (const actor of context.actors) {
    if (actor.nextDelivery || lookup.workers.has(actor.uid) || actorEconomyOwnerOf(context, actor) !== owner) continue;
    const home = lookup.homes.get(actor.home);
    if (!home) continue;
    if (allowClaim && canPromiseWalkingCarrier(actor, source.uid)) {
      entries.push({ atSource: true, availability: "unloading", id: actor.uid, routeCost: 0,
        value: { actor, points: [], unloading: true } });
      continue;
    }
    if (canReuseIndoorCarrier(actor)) {
      if (isDoorExitQueueFull(context, home)) continue;
      const route = context.options.roads.route(home.access, source.access);
      if (route) entries.push({ atSource: home.uid === source.uid, availability: "idle", id: actor.uid,
        routeCost: route.cost, value: { actor, indoor: home, points: route.points, unloading: false } });
      continue;
    }
    if (!allowReturning || !canReuseWalkingCarrier(actor)) continue;
    if (field === undefined) field = lazy ? context.options.roads.lengthField?.(source.access) ?? null : null;
    const entry = field ? deferReturning(actor, source, field) : searchReturning(context, actor, source);
    if (entry) entries.push(entry);
  }
  return entries;
};

/**
 * Existing ordinary crew for one source, in actor order (recruiting another settler is the
 * dispatcher's final fallback). A04d: a returning carrier's road search waits until `choose` or
 * `pickup` needs it; `choose` searches in bound order and stops once no remaining bound can beat the
 * best candidate, so it returns exactly `chooseTransportForJob` over the full candidate list.
 */
export const createWalkingCarrierPool = (
  context: SettlementContext, source: SettlementBuilding, allowClaim: boolean, allowReturning = true,
  lookup = createCarrierCrewLookup(context), lazy = lazyReturningRoutes
) => {
  const entries = pooledEntries(context, source, allowClaim, allowReturning, lookup, lazy);
  const byActor = new Map(entries.map(entry => [isReturningEntry(entry) ? entry.actor : entry.value.actor, entry]));
  let boundOrder: ReturningEntry[] | undefined;
  const resolve = (entry: PoolEntry) => {
    if (!isReturningEntry(entry)) return entry;
    if (entry.resolved === undefined) entry.resolved = searchReturning(context, entry.actor, source);
    return entry.resolved;
  };
  const byBound = () => boundOrder ??= entries.filter(isReturningEntry)
    .sort((a, b) => returningRank(a) - returningRank(b) || a.bound - b.bound);
  /** No unsearched entry from here on can replace `best`: its rank or its bound is already worse. */
  const cannotReplace = (entry: ReturningEntry, best: TransportReuseCandidate<unknown>) => {
    const rank = reuseRank(best);
    return returningRank(entry) > rank || (returningRank(entry) === rank && entry.bound > best.routeCost);
  };
  const choose = <T>(wrap: (pickup: WalkingCarrierPickup) => T, extra: readonly TransportReuseCandidate<T>[] = []) => {
    let best: TransportReuseCandidate<unknown> | undefined;
    for (const entry of entries) if (!isReturningEntry(entry)) best = preferCandidate(best, entry);
    for (const candidate of extra) best = preferCandidate(best, candidate);
    for (const entry of byBound()) {
      if (best && cannotReplace(entry, best)) break;
      const candidate = resolve(entry);
      if (candidate) best = preferCandidate(best, candidate);
    }
    const settled: TransportReuseCandidate<T>[] = [];
    for (const entry of entries) {
      const candidate = isReturningEntry(entry) ? entry.resolved : entry;
      if (candidate) settled.push({ ...candidate, value: wrap(candidate.value) });
    }
    settled.push(...extra);
    return chooseTransportForJob(settled);
  };
  return {
    choose,
    /** Every candidate with its route searched: the pre-A04d list. */
    candidates: () => entries.flatMap(entry => resolve(entry) ?? []),
    /**
     * False only for an actor that is no candidate. True for every candidate, and also for a listed
     * returning carrier whose deferred start check would still refuse it.
     */
    mayHold: (actor: SettlementActor) => byActor.has(actor),
    pickup: (actor: SettlementActor) => {
      const entry = byActor.get(actor);
      return entry ? resolve(entry)?.value : undefined;
    }
  };
};
export type WalkingCarrierPool = ReturnType<typeof createWalkingCarrierPool>;

/** Existing ordinary crew only, every route searched; recruiting another settler is the final fallback. */
export const walkingCarrierCandidates = (
  context: SettlementContext, source: SettlementBuilding, allowClaim: boolean, allowReturning = true,
  lookup = createCarrierCrewLookup(context)
): WalkingCandidate[] =>
  createWalkingCarrierPool(context, source, allowClaim, allowReturning, lookup, false).candidates();
