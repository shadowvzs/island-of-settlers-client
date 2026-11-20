import { countNavigation, profileNavigationStage } from "./navigation-profile";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * A12: each bucket is an array in filing order (the iteration order of the former `Set`: a removal
 * splices, a filing appends), which queries iterate faster than a set.
 */
interface PersonIndex {
  buckets: Map<number, SettlementActor[]>;
  membership: Map<SettlementActor, number>;
  order: Map<SettlementActor, number>;
}
const indexes = new WeakMap<SettlementContext, PersonIndex>();
const CELL_STRIDE = 65_536;
/** Packed integer cell key; avoids one string allocation per actor and query. */
const key = (point: SettlementPoint) => Math.floor(point.z) * CELL_STRIDE + Math.floor(point.x);

/** Rebuilt after bulk subsystem updates; individual movement updates membership immediately. */
export const beginPersonTrafficTick = (context: SettlementContext) =>
  profileNavigationStage("traffic.personIndexTick", () => beginPersonTrafficTickImpl(context));
const beginPersonTrafficTickImpl = (context: SettlementContext) => {
  let index = indexes.get(context);
  if (!index) {
    index = { buckets: new Map(), membership: new Map(), order: new Map() };
    indexes.set(context, index);
  }
  if (index.buckets.size > Math.max(64, context.actors.length * 4)) index.buckets.clear();
  else for (const bucket of index.buckets.values()) bucket.length = 0;
  index.membership.clear();
  index.order.clear();
  context.actors.forEach((actor, position) => {
    index.order.set(actor, position);
    updatePersonTraffic(context, actor);
  });
};
export const updatePersonTraffic = (context: SettlementContext, actor: SettlementActor) => {
  const index = indexes.get(context);
  if (!index) return;
  const previous = index.membership.get(actor);
  const next = actor.visible && actor.phase !== "retired" && actor.phase !== "catapultResupply" && actor.phase !== "catapultEvacuate" ? key(actor) : undefined;
  if (previous === next) return;
  if (previous !== undefined) {
    const bucket = index.buckets.get(previous);
    const filed = bucket?.indexOf(actor) ?? -1;
    if (filed >= 0) bucket!.splice(filed, 1);
    index.membership.delete(actor);
  }
  if (next === undefined) return;
  const bucket = index.buckets.get(next);
  if (bucket) bucket.push(actor);
  else index.buckets.set(next, [actor]);
  index.membership.set(actor, next);
  if (!index.order.has(actor)) index.order.set(actor, context.actors.indexOf(actor));
};
/** Catapult porters walk through everyone and are never returned by the unindexed scan either. */
const isScannedTraffic = (actor: SettlementActor) =>
  actor.phase !== "catapultResupply" && actor.phase !== "catapultEvacuate";
/** Visits the buckets of the query square in z, x order; stops when `visit` returns true. */
const visitBuckets = (index: PersonIndex, point: SettlementPoint, radius: number,
  visit: (bucket: readonly SettlementActor[], x: number, z: number) => boolean | void) => {
  for (let z = Math.floor(point.z - radius); z <= Math.floor(point.z + radius); z++)
    for (let x = Math.floor(point.x - radius); x <= Math.floor(point.x + radius); x++) {
      const bucket = index.buckets.get(z * CELL_STRIDE + x);
      if (bucket && visit(bucket, x, z) === true) return true;
    }
  return false;
};
/** Up to this many people are ordered by insertion sort; larger groups by a decorated stable sort. */
const INSERTION_SORT_LIMIT = 24;
/**
 * A12: the stable sort by actor order with each order read once (was two map reads per comparison).
 * Equal orders (an actor appended after a removal this tick) keep their visit order, as before.
 */
const byOrder = (index: PersonIndex, actors: SettlementActor[]) => {
  if (actors.length <= 1) return actors;
  const orders = actors.map(actor => index.order.get(actor)!);
  if (actors.length > INSERTION_SORT_LIMIT) {
    const positions = actors.map((_, position) => position)
      .sort((a, b) => orders[a]! - orders[b]! || a - b);
    const visited = actors.slice();
    positions.forEach((position, rank) => { actors[rank] = visited[position]!; });
    return actors;
  }
  for (let next = 1; next < actors.length; next++) {
    const actor = actors[next]!, order = orders[next]!;
    let slot = next;
    for (; slot > 0 && orders[slot - 1]! > order; slot--) {
      orders[slot] = orders[slot - 1]!;
      actors[slot] = actors[slot - 1]!;
    }
    orders[slot] = order;
    actors[slot] = actor;
  }
  return actors;
};
/** Preserve original actor-array tie breaking; standalone/test contexts use the original scan. */
export const nearbyTrafficActors = (
  context: SettlementContext,
  point: SettlementPoint,
  radius: number
): SettlementActor[] => profileNavigationStage("traffic.nearbyActors", () =>
  nearbyTrafficActorsImpl(context, point, radius));
const nearbyTrafficActorsImpl = (
  context: SettlementContext,
  point: SettlementPoint,
  radius: number
): SettlementActor[] => {
  countNavigation("traffic.broadPhaseQueries");
  const index = indexes.get(context);
  if (!index) return context.actors.filter(isScannedTraffic);
  const candidates: SettlementActor[] = [];
  visitBuckets(index, point, radius, bucket => { for (const actor of bucket) candidates.push(actor); });
  countNavigation("traffic.broadPhaseCandidates", candidates.length);
  return byOrder(index, candidates);
};
/**
 * A10b: `nearbyTrafficActors(...).filter(keep)` with the sort applied to the kept actors only. Exact
 * for a pure `keep` (the sort is stable, so equal orders keep their visit order as before). Callers
 * use it where the original loop skipped the same actors without side effects.
 */
export const nearbyTrafficActorsWhere = (context: SettlementContext, point: SettlementPoint, radius: number,
  keep: (actor: SettlementActor) => boolean): SettlementActor[] => profileNavigationStage("traffic.nearbyActors",
  () => {
    countNavigation("traffic.broadPhaseQueries");
    const index = indexes.get(context);
    if (!index) return context.actors.filter(actor => isScannedTraffic(actor) && keep(actor));
    const kept: SettlementActor[] = [];
    visitBuckets(index, point, radius, bucket => { for (const actor of bucket) if (keep(actor)) kept.push(actor); });
    return byOrder(index, kept);
  });
/**
 * A12: `nearbyTrafficActorsWhere(...)[0]` without the sort: the kept person of lowest order (the first
 * visited on equal orders). `keep` must be pure.
 */
export const firstNearbyTrafficActorWhere = (context: SettlementContext, point: SettlementPoint, radius: number,
  keep: (actor: SettlementActor) => boolean): SettlementActor | undefined =>
  profileNavigationStage("traffic.nearbyActors", () => {
    countNavigation("traffic.broadPhaseQueries");
    const index = indexes.get(context);
    if (!index) return context.actors.find(actor => isScannedTraffic(actor) && keep(actor));
    let first: SettlementActor | undefined, firstOrder = Infinity;
    visitBuckets(index, point, radius, bucket => {
      for (const actor of bucket) {
        if (!keep(actor)) continue;
        const order = index.order.get(actor)!;
        if (order < firstOrder) { first = actor; firstOrder = order; }
      }
    });
    return first;
  });
/** Order-free neighbourhood visit for boolean queries: skips the tie-break sort. Stops when
 * `visit` returns true and reports whether it stopped. */
export const forEachNearbyTrafficActor = (...args: Parameters<typeof forEachNearbyTrafficActorImpl>) =>
  profileNavigationStage("traffic.forEachNearby", () => forEachNearbyTrafficActorImpl(...args));
const forEachNearbyTrafficActorImpl = (
  context: SettlementContext,
  point: SettlementPoint,
  radius: number,
  visit: (actor: SettlementActor) => boolean | void
) => {
  countNavigation("traffic.broadPhaseQueries");
  const index = indexes.get(context);
  if (!index) return context.actors.some(actor => isScannedTraffic(actor) && visit(actor) === true);
  return visitBuckets(index, point, radius, bucket => {
    for (const actor of bucket) if (visit(actor) === true) return true;
  });
};
/**
 * A10b: every indexed actor a query around `point` with `radius` sees, with the cell it is filed under
 * (not its live position, which may have moved since its last update). One wide visit can then answer
 * several smaller queries exactly by `isTrafficCellInRange`. Without an index the cell is `undefined`:
 * the scan fallback returns every actor to every query.
 */
export const forEachNearbyTrafficCell = (context: SettlementContext, point: SettlementPoint, radius: number,
  visit: (actor: SettlementActor, cellX: number | undefined, cellZ: number | undefined) => void) => {
  countNavigation("traffic.broadPhaseQueries");
  const index = indexes.get(context);
  if (!index) {
    for (const actor of context.actors) if (isScannedTraffic(actor)) visit(actor, undefined, undefined);
    return;
  }
  visitBuckets(index, point, radius, (bucket, x, z) => { for (const actor of bucket) visit(actor, x, z); });
};
/** Whether a query around `point` with `radius` visits the cell (`undefined`: the unindexed scan). */
export const isTrafficCellInRange = (cellX: number | undefined, cellZ: number | undefined,
  point: SettlementPoint, radius: number) =>
  cellX === undefined || cellZ === undefined || (
    cellX >= Math.floor(point.x - radius) && cellX <= Math.floor(point.x + radius) &&
    cellZ >= Math.floor(point.z - radius) && cellZ <= Math.floor(point.z + radius));
export const clearPersonTraffic = (context: SettlementContext) => indexes.delete(context);
