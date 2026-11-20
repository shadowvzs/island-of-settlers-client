import { TICK_SECONDS } from "../../../../island-of-settlers-shared/src/time/constants";
import { RUIN_CLEARER_LIMIT, RUIN_SEARCHES_PER_RUN } from "../balance/military";
import { TERRITORY_RADII } from "../balance/territory";
import { ownerThreatenedAt } from "./military-civilian-safety";
import { outingPath, outingStorage } from "./settlement-outing-dispatch";
import { hasEconomy } from "./settlement-ownership";
import { createActor } from "./settlement-paths";
import { clearsRuin, startRuinClearer } from "./settlement-ruin-clearing";
import {
  backOffRuin, resetRuinBackoff, ruinInBackoff, ruinKnownUnreachable, type SettlementRuin
} from "./settlement-ruins";
import { ownsTerritoryPoint } from "./settlement-territory";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";
import { contextStorageCapacity, type StorageCapacitySnapshot, storageRoom } from "./storage-capacity";

/**
 * BD2 clearing job, the dispatch (owner gate todo:161 points 1-6, plan review B8a-c): it runs with the
 * scheduler after the deliveries and the cart dispatch, so it only takes settlers those left idle. Each ruin is
 * looked at once a second (every second scheduler run, by uid parity), cheap checks first; only a ruin that
 * passes them all costs one reachability search, at most `RUIN_SEARCHES_PER_RUN` of them per run however many
 * ruins a battle leaves, and an unreachable one backs off in saved game ticks. Nobody
 * is recruited while a ruin is blocked. Every check reads the ruin's owner, so an economy faction's ruins are
 * cleared by its own settlers from its own storages, and wait while enemies that faction knows stand near (EAI2b).
 */
const SCHEDULE_TICKS = Math.round(.5 / TICK_SECONDS);

let searches = 0;
/** Reachability searches the dispatch has run so far (the B8b path-search gate). */
export const ruinPathSearches = () => searches;

/** Owner 2026-11-09: a military ruin is cleared only while its plot lies in its owner's territory. */
const outsideTerritory = (context: SettlementContext, ruin: SettlementRuin) =>
  TERRITORY_RADII[ruin.typeId] !== undefined && !ownsTerritoryPoint(context, ruin, ruin.owner);

/** Enemies the owner knows near the ruin keep its clearers home. */
const threatened = (context: SettlementContext, ruin: SettlementRuin) =>
  ownerThreatenedAt(context, ruin.owner, ruin.access);

/** Whether the storage's pool has room for the whole salvage (one capacity snapshot per storage and run). */
const hasSalvageRoom = (
  context: SettlementContext, storage: SettlementBuilding, ruin: SettlementRuin,
  capacities: Map<number, StorageCapacitySnapshot>
) => {
  const wares = Object.entries(ruin.salvage);
  if (!wares.length) return true;
  let capacity = capacities.get(storage.uid);
  if (!capacity) {
    capacity = contextStorageCapacity(context, storage);
    capacities.set(storage.uid, capacity);
  }
  return wares.every(([ware, count]) => storageRoom(capacity, ware) >= count);
};

/** The storage to send a clearer from, or none while backoff, territory, raiders, settlers or room block it. */
const dispatchStorage = (
  context: SettlementContext, ruin: SettlementRuin, tick: number, capacities: Map<number, StorageCapacitySnapshot>
) => {
  if (ruinInBackoff(context, ruin, tick) || outsideTerritory(context, ruin) || threatened(context, ruin))
    return undefined;
  const storage = outingStorage(context, ruin.owner, ruin.access);
  return storage && hasSalvageRoom(context, storage, ruin, capacities) ? storage : undefined;
};

/** One reachability search; a found way sends a settler of the storage out, a missing one backs the ruin off. */
const tryDispatch = (context: SettlementContext, ruin: SettlementRuin, storage: SettlementBuilding,
  tick: number) => {
  searches++;
  const path = outingPath(context, storage, ruin.access);
  if (!path) {
    backOffRuin(context, ruin, tick);
    return false;
  }
  const actor = createActor(context, "Settler", storage.uid);
  startRuinClearer(actor, storage, ruin, path);
  ruin.clearer = actor.uid;
  resetRuinBackoff(ruin);
  return true;
};

/** A clearer that fled or was lost leaves its ruin unassigned; the work done so far is kept. */
const activeClearers = (context: SettlementContext, ruins: readonly SettlementRuin[]) => {
  const active = new Map<number, number>();
  for (const ruin of ruins) {
    if (ruin.clearer === undefined) continue;
    const actor = context.actors.find(entry => entry.uid === ruin.clearer);
    if (!actor || !clearsRuin(actor, ruin.uid)) {
      if (actor?.ruinClearing === ruin.uid) actor.ruinClearing = undefined;
      ruin.clearer = undefined;
      continue;
    }
    active.set(ruin.owner, (active.get(ruin.owner) ?? 0) + 1);
  }
  return active;
};

/**
 * Scheduler step: releases lost clearers, then looks at the ruins whose turn it is, starting one further on every
 * run (fair under the search budget), and spends at most `RUIN_SEARCHES_PER_RUN` reachability searches.
 */
export const dispatchRuinClearing = (context: SettlementContext) => {
  const ruins = context.ruins;
  if (!ruins?.length) return;
  const tick = context.clock?.tick() ?? 0, run = Math.floor(tick / SCHEDULE_TICKS);
  const active = activeClearers(context, ruins), capacities = new Map<number, StorageCapacitySnapshot>();
  let budget = RUIN_SEARCHES_PER_RUN;
  for (let index = 0; index < ruins.length && budget > 0; index++) {
    const ruin = ruins[(run + index) % ruins.length]!;
    if (ruin.clearer !== undefined || ruin.uid % 2 !== run % 2 || !hasEconomy(context, ruin.owner) ||
      (active.get(ruin.owner) ?? 0) >= RUIN_CLEARER_LIMIT) continue;
    const storage = dispatchStorage(context, ruin, tick, capacities);
    if (!storage) continue;
    budget--;
    if (tryDispatch(context, ruin, storage, tick)) active.set(ruin.owner, (active.get(ruin.owner) ?? 0) + 1);
  }
};

/**
 * Quiet-island skip guard (plan review B8g): every ruin waits for something a quiet island never changes (a
 * backoff with unchanged navigation, territory, no idle settler, no room) and no clearer is out. The quiet
 * ticks still run `dispatchRuinClearing`, so a backoff retry happens on the same tick as in exact play.
 */
export const ruinsQuiet = (context: SettlementContext) => {
  const tick = context.clock?.tick() ?? 0, capacities = new Map<number, StorageCapacitySnapshot>();
  const quiet = (ruin: SettlementRuin) => {
    if (ruin.clearer !== undefined) return false;
    // A known unreachable ruin with unchanged navigation fails its retry exactly as before.
    if (!hasEconomy(context, ruin.owner) || ruinKnownUnreachable(context, ruin)) return true;
    return !dispatchStorage(context, ruin, tick, capacities);
  };
  return (context.ruins ?? []).every(quiet);
};
