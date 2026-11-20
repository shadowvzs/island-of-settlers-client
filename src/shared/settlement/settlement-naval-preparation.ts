import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { getConstructionCost } from "./construction-costs";
import { harbourHelperSupply } from "./harbour-helper-supply";
import { dropNavalPerson } from "./naval-person-release";
import { addGood, STORAGE_IDS } from "./production-rules";
import { isOwnBuilding } from "./settlement-home";
import type { createNavalExpeditions } from "./settlement-naval-expeditions";
import type { createNavalFleet, NavalExpedition } from "./settlement-naval-fleet";
import type { createNavalPassengers } from "./settlement-naval-passengers";
import type { Goods, SettlementBuilding, SettlementContext } from "./settlement-types";
import { uniquePoolSources } from "./shared-storage-ware-sources";

/** Reusable tools the founding crew takes; the harbour recipe supplies the construction wares. */
export const EXPEDITION_EQUIPMENT: Readonly<Goods> = Object.freeze({ hammer: 1, shovel: 1 });
/** Derived from the current nation's harbour receipt, never a second copy of the construction cost. */
export const expeditionSupplies = (nation: WorkerNation = "roman"): Readonly<Goods> => Object.freeze({
  ...getConstructionCost(39, nation), ...EXPEDITION_EQUIPMENT
});
/** Roman/default receipt for callers without a nation context (tests and non-game tools). */
export const EXPEDITION_SUPPLIES: Readonly<Goods> = expeditionSupplies("roman");
/** Builder first, then the shovel worker (Leveler), then the carrier. */
export const EXPEDITION_ROLES = ["Builder", "Leveler", "Carrier"] as const;
export const EXPEDITION_CREW = EXPEDITION_ROLES.length;
export interface ExpeditionPreparation {
  id: number;
  sourceUid: number;
  target: NavalExpedition;
  cargo: Goods;
  passengers: number[];
  /** The idle, reachable own ship held for this operation from confirmation until launch. */
  shipId?: number;
}
export interface ExpeditionPreparationState {
  nextPreparation: number;
  preparations: ExpeditionPreparation[];
}
export interface ExpeditionPreparationSnapshot {
  id: number;
  sourceUid: number;
  cargo: Goods;
  crew: number;
  builder: boolean;
  shipAvailable: boolean;
  ready: boolean;
  status: "supplies" | "crew" | "ship" | "shore" | "ready";
}
interface PreparationHooks {
  fleet: Pick<ReturnType<typeof createNavalFleet>, "expeditionTargets" | "pending" | "queueTransport" |
    "releaseShipReservation" | "reserveShip" | "reservedShip" | "snapshot">;
  passengers: Pick<ReturnType<typeof createNavalPassengers>, "reserve" | "release" | "ready">;
  site: ReturnType<typeof createNavalExpeditions>["site"];
}
const clonePreparation = (preparation: ExpeditionPreparation): ExpeditionPreparation => ({
  ...preparation, cargo: { ...preparation.cargo }, passengers: preparation.passengers.slice(),
  target: { ...preparation.target, water: { ...preparation.target.water } }
});
const positiveEntries = (goods: Readonly<Goods>) =>
  Object.entries(goods).filter(([, count]) => count > 0);
const sameTarget = (
  first: Pick<NavalExpedition, "x" | "z" | "water">,
  second: Pick<NavalExpedition, "x" | "z" | "water">
) => Math.abs(first.x - second.x) < .01 && Math.abs(first.z - second.z) < .01 &&
  Math.abs(first.water.x - second.water.x) < .01 && Math.abs(first.water.z - second.water.z) < .01;

/** Completed friendly storages whose carriers can physically reach `source` over the road network. */
const reachableStorages = (context: SettlementContext, source: SettlementBuilding) =>
  context.buildings.filter(building => building.construction === 1 &&
    STORAGE_IDS.has(building.typeId) && isOwnBuilding(building) &&
    (building.uid === source.uid ||
      Boolean(context.options.roads.route(building.access, source.access))));
/** Free stock after cargo already promised to ships and unfinished work sites. */
const freeStock = (building: SettlementBuilding, ware: string) => {
  const promised = building.storagePoolId === undefined ? building.shipReserve?.[ware] ?? 0 : 0;
  const siteNeed = building.construction < 1
    ? Math.max(0, (building.required[ware] ?? 0) - (building.input[ware] ?? 0) -
      (building.incoming[ware] ?? 0) - (building.constructionConsumed?.[ware] ?? 0))
    : 0;
  return Math.max(0, (building.inventory[ware] ?? 0) - promised - siteNeed);
};
const reachableStock = (context: SettlementContext, source: SettlementBuilding, ware: string) =>
  uniquePoolSources(reachableStorages(context, source)).reduce((sum, building) => sum + freeStock(building, ware), 0);

/** A preparation owns paid stock, a real crew and a reserved ship until the fleet handover. */
export const createExpeditionPreparations = (context: SettlementContext, hooks: PreparationHooks) => {
  const supplies = expeditionSupplies(context.playerNation ?? "roman");
  const active = new Map<number, ExpeditionPreparation>();
  const blocked = new Set<number>();
  let nextPreparation = 1, retryTime = 0;
  const sourceOf = (uid: number) => context.buildings.find(building =>
    building.uid === uid && building.typeId === 39 && building.construction === 1);
  const recoverySource = (uid: number) => sourceOf(uid) ??
    context.buildings.find(building => building.construction === 1 && STORAGE_IDS.has(building.typeId) &&
      isOwnBuilding(building));
  const shipAvailable = (preparation: ExpeditionPreparation) =>
    preparation.shipId !== undefined && hooks.fleet.reservedShip(preparation.shipId) !== null;
  const suppliesReady = (preparation: ExpeditionPreparation) => Object.entries(supplies)
    .every(([ware, count]) => (preparation.cargo[ware] ?? 0) === count);
  const crewReady = (preparation: ExpeditionPreparation) =>
    preparation.passengers.length === EXPEDITION_CREW && hooks.passengers.ready(preparation.passengers);
  const targetClaimed = (target: NavalExpedition) =>
    [...active.values()].some(preparation => sameTarget(preparation.target, target)) ||
    hooks.fleet.pending().some(order => Boolean(order.expedition && sameTarget(order.expedition, target))) ||
    hooks.fleet.expeditionTargets().some(other => sameTarget(other, target)) ||
    context.buildings.some(building => building.foundedByExpedition && building.construction < 1 &&
      Math.abs(building.x - target.x) < .01 && Math.abs(building.z - target.z) < .01);
  const reserveSupplies = (preparation: ExpeditionPreparation, source: SettlementBuilding) => {
    for (const [ware, count] of Object.entries(supplies)) {
      const amount = Math.min(count - (preparation.cargo[ware] ?? 0), source.inventory[ware] ?? 0);
      if (amount <= 0) continue;
      addGood(source.inventory, ware, -amount);
      addGood(preparation.cargo, ware, amount);
    }
  };
  const reserveCrew = (preparation: ExpeditionPreparation, source: SettlementBuilding) => {
    const wanted = Math.min(EXPEDITION_CREW - preparation.passengers.length,
      harbourHelperSupply(context, source));
    if (wanted <= 0) return true;
    const ids = hooks.passengers.reserve(source, wanted, 0);
    if (!ids) return false;
    for (const [index, uid] of ids.entries()) {
      const actor = context.actors.find(candidate => candidate.uid === uid);
      if (actor) actor.job = EXPEDITION_ROLES[preparation.passengers.length + index] ?? "Settler";
    }
    preparation.passengers.push(...ids);
    return true;
  };
  const refundSupplies = (preparation: ExpeditionPreparation, destination: SettlementBuilding) => {
    for (const [ware, count] of positiveEntries(preparation.cargo))
      addGood(destination.inventory, ware, count);
    preparation.cargo = {};
  };
  const releaseShip = (preparation: ExpeditionPreparation) => {
    if (preparation.shipId === undefined) return;
    hooks.fleet.releaseShipReservation(-preparation.id);
    preparation.shipId = undefined;
  };
  const cancel = (id: number) => {
    const preparation = active.get(-id);
    if (!preparation) return false;
    const source = recoverySource(preparation.sourceUid);
    if (!source) return false;
    refundSupplies(preparation, source);
    hooks.passengers.release(preparation.passengers, source);
    releaseShip(preparation);
    active.delete(preparation.id);
    blocked.delete(preparation.id);
    return true;
  };
  const launch = (preparation: ExpeditionPreparation) => {
    const source = sourceOf(preparation.sourceUid);
    if (!source || !suppliesReady(preparation) || !crewReady(preparation) ||
      !shipAvailable(preparation)) return null;
    const target = hooks.site(preparation.target);
    if (!target) { blocked.add(preparation.id); return null; }
    blocked.delete(preparation.id);
    // Fleet debits ordinary storage atomically. Restore the isolated receipt on a failed handover.
    for (const [ware, count] of positiveEntries(preparation.cargo)) addGood(source.inventory, ware, count);
    const id = hooks.fleet.queueTransport(source.uid, source.uid, preparation.cargo,
      preparation.passengers, target, undefined, undefined, preparation.shipId);
    if (id === null) {
      blocked.add(preparation.id);
      for (const [ware, count] of positiveEntries(preparation.cargo))
        addGood(source.inventory, ware, -count);
      return null;
    }
    for (const uid of preparation.passengers)
      context.actors.find(actor => actor.uid === uid)!.navalOrder = id;
    active.delete(preparation.id);
    blocked.delete(preparation.id);
    return id;
  };
  return {
    /** A reserved helper lost on land: the preparation gathers another one. */
    forgetPerson: (uid: number) => { for (const preparation of active.values()) dropNavalPerson(preparation, uid); },
    start: (sourceUid: number, point: { x: number; z: number; rotation: number }) => {
      const source = sourceOf(sourceUid);
      const target = source && hooks.site(point);
      // One voyage at a time from a harbour: exploration returning or still sailing also owns the
      // harbour's expedition slot, so a second settlement cannot be queued behind it.
      if (!source || !target || [...active.values()].some(preparation =>
        preparation.sourceUid === sourceUid) ||
        hooks.fleet.pending().some(order => order.sourceUid === sourceUid &&
          (order.expedition || order.exploration)) ||
        hooks.fleet.snapshot().some(ship => ship.sourceUid === sourceUid &&
          (ship.expedition || ship.exploration || ship.foundingSiteUid !== undefined)) ||
        targetClaimed(target) || harbourHelperSupply(context, source) < EXPEDITION_CREW ||
        Object.entries(supplies).some(([ware, count]) =>
          reachableStock(context, source, ware) < count)) return null;
      const id = nextPreparation;
      const shipId = hooks.fleet.reserveShip(sourceUid, -id);
      if (shipId === null) return null;
      const preparation: ExpeditionPreparation = {
        id, sourceUid, target, cargo: {}, passengers: [], shipId
      };
      active.set(id, preparation);
      reserveSupplies(preparation, source);
      if (!reserveCrew(preparation, source)) {
        refundSupplies(preparation, source);
        hooks.passengers.release(preparation.passengers, source);
        releaseShip(preparation);
        active.delete(id);
        return null;
      }
      nextPreparation++;
      return launch(preparation) ?? -id;
    },
    cancel,
    removeBuilding: (uid: number) => {
      for (const preparation of active.values())
        if (preparation.sourceUid === uid && !cancel(-preparation.id)) blocked.add(preparation.id);
    },
    demand: (uid: number): Goods => {
      const preparation = [...active.values()].find(entry => entry.sourceUid === uid);
      const source = preparation && sourceOf(uid);
      if (!preparation || !source) return {};
      return Object.fromEntries(Object.entries(supplies).map(([ware, count]) =>
        [ware, Math.max(0, count - (preparation.cargo[ware] ?? 0) - freeStock(source, ware) -
          (source.incoming[ware] ?? 0))]));
    },
    update: (dt: number) => {
      if (!active.size || !Number.isFinite(dt) || dt <= 0) return;
      for (const preparation of active.values()) {
        const source = sourceOf(preparation.sourceUid);
        if (!source) continue;
        if (!shipAvailable(preparation)) {
          preparation.shipId = undefined;
          const shipId = hooks.fleet.reserveShip(source.uid, -preparation.id);
          if (shipId === null) blocked.add(preparation.id);
          else { preparation.shipId = shipId; blocked.delete(preparation.id); }
        }
        reserveSupplies(preparation, source);
        reserveCrew(preparation, source);
      }
      retryTime -= dt;
      if (retryTime > 0) return;
      retryTime = 1;
      for (const preparation of active.values()) launch(preparation);
    },
    snapshot: (): ExpeditionPreparationSnapshot[] => [...active.values()].map(preparation => {
      const hasShip = shipAvailable(preparation), hasSupplies = suppliesReady(preparation);
      const crewGood = crewReady(preparation);
      let status: ExpeditionPreparationSnapshot["status"] = "ready";
      if (!hasSupplies) status = "supplies";
      else if (!crewGood) status = "crew";
      else if (!hasShip) status = "ship";
      else if (blocked.has(preparation.id)) status = "shore";
      return { id: -preparation.id, sourceUid: preparation.sourceUid, cargo: { ...preparation.cargo },
        crew: preparation.passengers.length, builder: preparation.passengers.length > 0,
        shipAvailable: hasShip, ready: status === "ready", status };
    }),
    saveState: (): ExpeditionPreparationState => ({ nextPreparation,
      preparations: [...active.values()].map(clonePreparation) }),
    restore: (saved?: ExpeditionPreparationState) => {
      active.clear(); blocked.clear(); retryTime = 0; nextPreparation = saved?.nextPreparation ?? 1;
      for (const preparation of saved?.preparations ?? [])
        active.set(preparation.id, clonePreparation(preparation));
    }
  };
};
