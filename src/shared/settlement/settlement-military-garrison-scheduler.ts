import { isCatapultPorter } from "./military-catapult-resupply";
import { canGarrisonMilitaryType, militaryTroopTool } from "./military-combat-rules";
import { canLeaveGarrison } from "./military-garrison-preservation";
import {
  compositionTotal, emptyComposition, type GarrisonComposition, type GarrisonTroop, isGarrisonTroop,
  militaryBuildingCapacity, nextGarrisonTroop, surplusGarrisonTroop
} from "./military-garrison-rules";
import { STORAGE_IDS } from "./production-rules";
import { getBuilding } from "./settlement-building-index";
import { exitPath } from "./settlement-entrance";
import type { SettlementSoldier } from "./settlement-military";
import type { SoldierBuildingIndex, SoldierLookup } from "./settlement-military-soldier-index";
import type { createMilitaryStorage } from "./settlement-military-storage";
import { economyOwnerOf, ownerOf } from "./settlement-ownership";
import { setActorPath } from "./settlement-paths";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

/** Reachable storages of the military building's owner, cheapest road route first (EAI1a A28 lookup). */
export const warehousesFor = (context: SettlementContext, building: SettlementBuilding) =>
  context.buildings.filter((home) => home.construction === 1 &&
    ownerOf(home) === economyOwnerOf(context, building) && STORAGE_IDS.has(home.typeId))
    .map((home) => ({ home, route: context.options.roads.route(home.access, building.access) }))
    .filter((entry) => entry.route)
    .sort((a, b) => a.route!.cost - b.route!.cost || a.home.uid - b.home.uid);

/** Soldiers of one building grouped by garrison type. */
export const compositionOf = (lookup: SoldierLookup, uid: number, stationedOnly = false) => {
  const counts = emptyComposition();
  for (const soldier of lookup(uid)) {
    const type = soldier.combat?.type ?? "shield";
    if (isGarrisonTroop(type) && (!stationedOnly || soldier.stationed)) counts[type]++;
  }
  return counts;
};

/** A new Catapult has its heavy operator and one real shield porter; manual targets still win. */
export const defaultMilitaryGarrisonTarget = (building: SettlementBuilding, homeBuilding?: number | null) => {
  if (building.typeId === 16) return 2;
  if (homeBuilding === 39) return 1;
  return militaryBuildingCapacity(building);
};

/**
 * Stored, garrisonable soldiers per storage and type; built once per scheduling pass. The
 * caller-owned `actorByUid` map is refilled instead of allocating a new lookup per pass.
 */
const indexStoredReserves = (
  actors: readonly SettlementActor[], soldiers: Iterable<SettlementSoldier>,
  actorByUid: Map<number, SettlementActor>, eligible?: (soldier: SettlementSoldier) => boolean
) => {
  const index = new Map<number, Partial<Record<GarrisonTroop, SettlementSoldier>>>();
  actorByUid.clear();
  for (const actor of actors) actorByUid.set(actor.uid, actor);
  for (const soldier of soldiers) {
    const type = soldier.combat?.type ?? "shield", actor = actorByUid.get(soldier.actor);
    if (soldier.building !== -1 || !isGarrisonTroop(type) || !actor || actor.navalOrder !== undefined ||
      eligible?.(soldier) === false) continue;
    const stored = index.get(actor.home) ?? {};
    stored[type] ??= soldier; index.set(actor.home, stored);
  }
  return index;
};

/** Moves a stored soldier to a building's garrison and keeps the pass index current. */
const deploySoldier = (
  context: SettlementContext, soldiers: Map<number, SettlementSoldier>, soldierIndex: SoldierBuildingIndex,
  actor: SettlementActor, building: SettlementBuilding, rank: number, route: SettlementActor["path"]
) => {
  const previous = soldiers.get(actor.uid), combatant = previous?.combat;
  if (!canGarrisonMilitaryType(combatant?.type)) return;
  actor.building = building.uid;
  actor.tool = militaryTroopTool(combatant?.type);
  const home = context.buildings.find((entry) => entry.uid === actor.home)!;
  setActorPath(actor, [...exitPath(home), ...route], "assigned");
  const soldier: SettlementSoldier = {
    actor: actor.uid, rank, building: building.uid, stationed: false, combat: combatant };
  soldiers.set(actor.uid, soldier);
  soldierIndex.move(soldier, previous?.building);
};

export interface GarrisonSchedulerDeps {
  /** `combat.buildingStanding`. */
  buildingStanding: (uid: number) => boolean;
  compositions: Map<number, GarrisonComposition>;
  /** `combat.fortifyEconomyGarrison`. */
  fortifyEconomyGarrison: (building: SettlementBuilding) => void;
  isEconomyGarrison: (building: SettlementBuilding) => boolean;
  militaryBuildings: () => SettlementBuilding[];
  soldierIndex: SoldierBuildingIndex;
  soldiers: Map<number, SettlementSoldier>;
  storage: ReturnType<typeof createMilitaryStorage>;
  targets: Map<number, number>;
}

/**
 * Garrison filling and release: stored soldiers walk to buildings below their target by road, surplus soldiers walk
 * home, and computer economies garrison from their own depot (EAI2b). Split out of `createSettlementMilitary`.
 */
export const createGarrisonScheduler = (context: SettlementContext, deps: GarrisonSchedulerDeps) => {
  const { compositions, militaryBuildings, soldierIndex, soldiers, storage, targets } = deps;
  const reserveActors = new Map<number, SettlementActor>();
  const target = (building: SettlementBuilding) => {
    const manual = compositions.get(building.uid);
    const capacity = militaryBuildingCapacity(building);
    if (building.typeId === 16 && manual) return Math.min(capacity, compositionTotal(manual));
    const total = Math.min(capacity, targets.get(building.uid) ??
      defaultMilitaryGarrisonTarget(building, context.options.homeBuilding));
    return manual ? Math.min(total, compositionTotal(manual)) : total;
  };
  const indexReserves = () => indexStoredReserves(context.actors, soldiers.values(), reserveActors);
  type Reserves = ReturnType<typeof indexReserves>;
  type Storages = ReturnType<typeof warehousesFor>;
  /** Storages (with road routes) are only looked up once a building actually needs a soldier. */
  const lazyStorages = (building: SettlementBuilding) => {
    let storages: Storages | undefined;
    return () => (storages ??= warehousesFor(context, building));
  };
  const storedIn = (storages: () => Storages, reserves: Reserves) => (type: GarrisonTroop) =>
    storages().some(({ home }) => reserves.get(home.uid)?.[type]);
  /** Sends the stored `wanted` soldier of the first reachable storage holding one along its road route. */
  const deployStored = (building: SettlementBuilding, wanted: GarrisonTroop, storages: () => Storages,
    reserves: Reserves) => {
    const source = storages().find(({ home }) => reserves.get(home.uid)?.[wanted])!;
    const reserve = reserves.get(source.home.uid)![wanted]!;
    deploySoldier(context, soldiers, soldierIndex, context.actors.find((actor) => actor.uid === reserve.actor)!,
      building, reserve.rank, source.route!.points);
  };
  const scheduleWith = (lookup: SoldierLookup) => {
    let reserves: Reserves | undefined;
    for (const building of militaryBuildings()) {
      const assigned = lookup(building.uid), count = assigned.length;
      const stationed = assigned.filter((soldier) => soldier.stationed).length;
      const travelling = count - stationed;
      let arrival = "";
      if (travelling) arrival = ` · ${travelling} arriving`;
      else if (count < target(building)) arrival = " · Waiting for stored soldiers";
      building.status = `${stationed}/${target(building)} soldiers${arrival}`;
      const manual = compositions.get(building.uid);
      const replacingLast = count === 1 && stationed === 1 && manual && assigned.some(soldier =>
        manual[(soldier.combat?.type ?? "shield") as GarrisonTroop] === 0);
      if (count >= target(building) && !replacingLast) continue;
      const storages = lazyStorages(building);
      reserves ??= indexReserves();
      const wanted = nextGarrisonTroop(building.typeId, compositionOf(lookup, building.uid),
        compositions.get(building.uid), storedIn(storages, reserves), replacingLast ? 2 : target(building));
      // New soldiers come only from the Tavern; military buildings take stored soldiers only.
      if (!wanted || wanted === "recruit") continue;
      deployStored(building, wanted, storages, reserves);
      reserves = undefined;
    }
  };
  /** A computer economy's stored soldiers the economy may garrison: its own, none an A14 force holds. */
  const economyReserve = (owner: number) => (soldier: SettlementSoldier) =>
    soldier.combat?.faction === owner && context.militaryDirector?.owns(soldier.actor) !== true;
  /** An idle field soldier of `owner` no A14 force holds (A14-4c `uncommitted`): the lowest uid, or undefined. */
  const idleFieldSoldier = (owner: number) => {
    let idle: number | undefined;
    for (const soldier of soldiers.values()) {
      const state = soldier.combat;
      if (soldier.building !== -3 || state?.faction !== owner || state.type === "cavalry" ||
        state.target !== undefined || state.destination !== undefined || state.siege !== undefined ||
        context.militaryDirector?.owns(soldier.actor) === true || (idle !== undefined && soldier.actor > idle))
        continue;
      idle = soldier.actor;
    }
    return idle;
  };
  /** A stored soldier of the economy's own depot by road; else an idle uncommitted field soldier walks over. */
  const sendEconomySoldier = (building: SettlementBuilding, limit: number) => {
    const owner = ownerOf(building);
    const reserves = indexStoredReserves(context.actors, soldiers.values(), reserveActors, economyReserve(owner));
    const storages = lazyStorages(building);
    const wanted = nextGarrisonTroop(building.typeId, compositionOf(soldierIndex.of, building.uid), undefined,
      storedIn(storages, reserves), limit);
    if (wanted && wanted !== "recruit") {
      deployStored(building, wanted, storages, reserves);
      return true;
    }
    const idle = idleFieldSoldier(owner);
    return idle !== undefined && storage.garrison([idle], building.uid, owner) > 0;
  };
  /**
   * Economy AI `maintain` (EAI2b): one soldier of a computer economy walks to its finished, standing garrison
   * building below `target` (the economy AI's per tower, EAI4a; else the default): a stored soldier of its depot
   * by the player's road deployment, else an idle field soldier no A14 force holds (the director never takes
   * soldiers inside buildings and releases field soldiers it does not use). The building takes its owner's door
   * and walls with it; false when none fits.
   */
  const garrisonFromReserve = (uid: number, wanted?: number) => {
    const building = getBuilding(context, uid);
    if (!building || !deps.isEconomyGarrison(building) || !deps.buildingStanding(uid)) return false;
    soldierIndex.rebuild();
    const limit = Math.min(militaryBuildingCapacity(building), wanted ?? defaultMilitaryGarrisonTarget(building));
    if (soldierIndex.of(uid).length >= limit || !sendEconomySoldier(building, limit)) return false;
    deps.fortifyEconomyGarrison(building);
    return true;
  };
  /** Sends one stationed soldier of the chosen type (lowest rank first) back to the nearest storage. */
  const releaseOne = (building: SettlementBuilding, type: GarrisonTroop, lookup: SoldierLookup) => {
    const soldier = lookup(building.uid).filter((entry) => entry.stationed &&
      !isCatapultPorter(building, entry.actor) && (entry.combat?.type ?? "shield") === type)
      .sort((a, b) => a.rank - b.rank || b.actor - a.actor)[0];
    const home = warehousesFor(context, building)[0];
    if (!soldier || !home) return false;
    if (!canLeaveGarrison(context, context.actors.find(actor => actor.uid === soldier.actor)!)) return false;
    const actor = context.actors.find((entry) => entry.uid === soldier.actor)!;
    soldier.stationed = false; soldier.building = -2; actor.home = home.home.uid;
    soldierIndex.move(soldier, building.uid);
    setActorPath(actor, exitPath(building), "outbound");
    return true;
  };
  /** Over a cap or a manual count, or an automatic archer/melee swap: one soldier walks home. */
  const releaseSurplus = (lookup: SoldierLookup) => {
    let reserves: Reserves | undefined;
    for (const building of militaryBuildings()) {
      // Automatic releases and swaps only concern full (or over-full) buildings.
      const full = lookup(building.uid).length >= Math.min(target(building), militaryBuildingCapacity(building));
      if (!full && !compositions.has(building.uid)) continue;
      reserves ??= indexReserves();
      const stored = storedIn(lazyStorages(building), reserves);
      for (let released = 0; released < militaryBuildingCapacity(building); released++) {
        const surplus = surplusGarrisonTroop(building.typeId, compositionOf(lookup, building.uid),
          compositions.get(building.uid), stored, target(building));
        if (!surplus || !releaseOne(building, surplus, lookup)) break;
      }
    }
  };
  return { garrisonFromReserve, releaseSurplus, scheduleWith, target };
};
