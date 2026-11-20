import { STORAGE_IDS } from "./production-rules";
import { getBuilding } from "./settlement-building-index";
import { canEnterDoor, entrancePath, exitPath } from "./settlement-entrance";
import { findHomeBuilding, isOwnBuilding } from "./settlement-home";
import { createActor, moveActor, setActorPath } from "./settlement-paths";
import { addIdleSettlers, retirePerson } from "./settlement-population";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * Where idle settlers wait (POP-03, owner 2026-10-20): a newborn walks from the home building to the
 * nearest road-connected storehouse or harbour that needs people — one whose dispatch recently found
 * no idle settler of its own — and rests there; with none in need it stays at home.
 */
export const SETTLER_RELOCATE_PHASE = "settlerRelocate";
const SETTLER_RELOCATE_ENTER_PHASE = "settlerRelocateEnter";

const isFriendlyStorage = (building: SettlementBuilding | undefined): building is SettlementBuilding =>
  Boolean(building && STORAGE_IDS.has(building.typeId) && building.construction === 1 &&
    isOwnBuilding(building));

/** A dispatch from `storage` found no idle settler there; the next newborn may walk to it. */
export const noteSettlerDemand = (context: SettlementContext, storage: SettlementBuilding) => {
  if ((storage.idleSettlers ?? 0) > 0) return;
  context.population?.demand.add(storage.uid);
};

/** The nearest storage in need by road from `home` (only noted storages are routed, once a minute). */
const needyStorage = (context: SettlementContext, home: SettlementBuilding) => {
  type Route = NonNullable<ReturnType<SettlementContext["options"]["roads"]["route"]>>;
  let best: { route: Route; storage: SettlementBuilding } | undefined;
  for (const uid of context.population!.demand) {
    const storage = getBuilding(context, uid);
    if (!isFriendlyStorage(storage) || storage === home || (storage.idleSettlers ?? 0) > 0) continue;
    const route = context.options.roads.route(home.access, storage.access);
    if (route && (!best || route.length < best.route.length)) best = { route, storage };
  }
  return best;
};

/**
 * A settler born in `home` joins its idle pool, then walks on to a storage in need if there is one.
 * The demand noted since the last birth is consumed either way.
 */
export const placeNewborn = (context: SettlementContext, home: SettlementBuilding) => {
  addIdleSettlers(context, home);
  const target = needyStorage(context, home);
  context.population!.demand.clear();
  if (target) startSettlerRelocation(context, home, target.storage, target.route.points);
};

/** One idle settler of `home` leaves and walks `points` (home access to target access) to rest there. */
export const startSettlerRelocation = (
  context: SettlementContext,
  home: SettlementBuilding,
  target: SettlementBuilding,
  points: readonly SettlementPoint[]
) => {
  const actor = createActor(context, "Settler", home.uid);
  actor.building = target.uid;
  setActorPath(actor, [...exitPath(home), ...points], SETTLER_RELOCATE_PHASE);
  return actor;
};

/** True for a settler walking to (or entering) the storage `actor.building` to rest there. */
export const isSettlerRelocating = (actor: SettlementActor) =>
  actor.phase === SETTLER_RELOCATE_PHASE || actor.phase === SETTLER_RELOCATE_ENTER_PHASE;

/** The settler rests in `storage` from now on: the last storage it entered. */
const settle = (context: SettlementContext, actor: SettlementActor, storage: SettlementBuilding) => {
  actor.visible = false;
  actor.action = "idle";
  actor.home = storage.uid;
  actor.building = storage.uid;
  actor.path = [];
  actor.pathIndex = 0;
  retirePerson(context, actor);
  addIdleSettlers(context, storage);
};

/** Walks a relocating settler to its storage; true when this updater owns the actor's phase. */
export const updateSettlerRelocation = (context: SettlementContext, actor: SettlementActor, dt: number) => {
  if (actor.phase !== SETTLER_RELOCATE_PHASE && actor.phase !== SETTLER_RELOCATE_ENTER_PHASE) return false;
  const target = getBuilding(context, actor.building);
  if (!isFriendlyStorage(target)) {
    // The storage was lost on the way: the settler is never lost, it rests at its origin (or home).
    const fallback = getBuilding(context, actor.home);
    const shelter = isFriendlyStorage(fallback) ? fallback : findHomeBuilding(context);
    if (shelter) settle(context, actor, shelter);
    return true;
  }
  if (!moveActor(context, actor, dt)) return true;
  if (actor.phase === SETTLER_RELOCATE_ENTER_PHASE) {
    settle(context, actor, target);
    return true;
  }
  if (canEnterDoor(context, actor, target)) setActorPath(actor, entrancePath(target), SETTLER_RELOCATE_ENTER_PHASE);
  return true;
};
