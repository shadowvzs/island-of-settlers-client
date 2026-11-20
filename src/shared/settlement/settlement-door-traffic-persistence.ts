import { actorIncarnation } from "./actor-incarnation";
import { getBuilding } from "./settlement-building-index";
import { restoreStorageDepartures, saveStorageDepartures } from "./settlement-door-departures";
import type { SavedStorageTraffic } from "./settlement-door-traffic-state";
import { reservationWatchOrder, restoreReservationWatch, restoreReservationWatchOrder, saveReservationWatch } from "./settlement-reservation-watchdog";
import type { createTransientMap } from "./settlement-transient-state";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

type TransientMap<T> = ReturnType<typeof createTransientMap<T>>;
interface StorageTrafficCaches {
  clocks: TransientMap<number>; parkingBudgets: TransientMap<number>; arrivalSerial: TransientMap<number>;
  owners: TransientMap<Map<number, SettlementActor>>;
  ownerIdentities: WeakMap<Map<number, SettlementActor>, Map<number, object>>;
  queueIdentities: WeakMap<SettlementActor, object>;
  waiting: WeakMap<SettlementActor, SettlementPoint>; parkingPaths: WeakMap<SettlementActor, SettlementPoint[]>;
  staged: WeakSet<SettlementActor>;
  numericQueueCaches: Record<"registeredAt" | "deferred" | "deferredRetries" | "failedEntries" | "retries" | "queueCursor", WeakMap<SettlementActor, number>>;
  watchStorageTurn: (context: SettlementContext, owners: Map<number, SettlementActor>, actor: SettlementActor, building: SettlementBuilding) => void;
}
/** Preserve semantic FIFO/parking choices, never search scratch buffers or geometry caches. */
export const captureStorageTraffic = (context: SettlementContext, cache: StorageTrafficCaches): SavedStorageTraffic => {
  const { arrivalSerial, clocks, numericQueueCaches, ownerIdentities, owners, parkingBudgets, parkingPaths, queueIdentities, staged, waiting } = cache;
  const held = owners.get(context);
  return { clock: clocks.get(context) ?? 0, parkingBudget: parkingBudgets.get(context) ?? 4,
    arrivalSerial: arrivalSerial.get(context) ?? 0, watchOrder: reservationWatchOrder(context).filter(key => !!getBuilding(context, Number(key.split(":")[1]))),
    owners: [...held ?? []].filter(([uid, actor]) => !!getBuilding(context, uid) && context.actors.includes(actor))
      .map(([building, actor]) => ({ building, actor: actor.uid,
        identityCurrent: ownerIdentities.get(held!)?.get(building) === actorIncarnation(actor),
        watch: saveReservationWatch(context, `door:${building}`, actor) })),
    actors: context.actors.flatMap(actor => {
      const numeric = Object.fromEntries(Object.entries(numericQueueCaches).flatMap(([key, cache]) =>
        cache.has(actor) ? [[key, cache.get(actor)!]] : []));
      if (!Object.keys(numeric).length && !waiting.has(actor) && !parkingPaths.has(actor) &&
        !staged.has(actor) && !queueIdentities.has(actor)) return [];
      return [{ actor: actor.uid, phase: actor.phase, home: actor.home,
        identityKnown: queueIdentities.has(actor), identityCurrent: queueIdentities.get(actor) === actorIncarnation(actor), staged: staged.has(actor),
        waiting: waiting.get(actor), parkingPath: parkingPaths.get(actor), ...numeric }];
    }), departures: saveStorageDepartures(context) };
};
export const resumeStorageTraffic = (context: SettlementContext, cache: StorageTrafficCaches, saved?: SavedStorageTraffic) => {
  if (!saved) return;
  const { arrivalSerial, clocks, numericQueueCaches, ownerIdentities, owners, parkingBudgets, parkingPaths, queueIdentities, staged, waiting, watchStorageTurn } = cache;
  clocks.set(context, saved.clock); parkingBudgets.set(context, saved.parkingBudget);
  arrivalSerial.set(context, saved.arrivalSerial);
  const actors = new Map(context.actors.map(actor => [actor.uid, actor]));
  const held = new Map<number, SettlementActor>(); owners.set(context, held);
  const identities = new Map<number, object>(); ownerIdentities.set(held, identities);
  for (const value of saved.actors) {
    const actor = actors.get(value.actor);
    // Catch-up may retire or reclaim a person after the receipt was written. A stale receipt
    // cannot own a door turn anymore, so ignore it rather than dereferencing a removed actor.
    if (!actor) continue;
    if (value.identityKnown) queueIdentities.set(actor, value.identityCurrent ? actorIncarnation(actor) : {});
    for (const [key, cache] of Object.entries(numericQueueCaches)) {
      const amount = value[key as keyof typeof numericQueueCaches];
      if (amount !== undefined) cache.set(actor, amount);
    }
    if (value.waiting) waiting.set(actor, value.waiting);
    if (value.parkingPath) parkingPaths.set(actor, value.parkingPath);
    if (value.staged) staged.add(actor);
  }
  restoreStorageDepartures(context, saved.departures);
  for (const value of saved.owners) {
    const actor = actors.get(value.actor), building = getBuilding(context, value.building);
    if (!actor || !building) continue;
    held.set(value.building, actor);
    identities.set(value.building, value.identityCurrent ? actorIncarnation(actor) : {});
    if (value.watch) { watchStorageTurn(context, held, actor, building);
      restoreReservationWatch(context, `door:${value.building}`, value.watch); }
  }
  restoreReservationWatchOrder(context, saved.watchOrder);
};
