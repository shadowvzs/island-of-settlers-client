import { TRADE_MAX_ACTIVE_OFFERS } from "@shared/catalog/balance";

import { availabilityTier } from
  "../../../../island-of-settlers-shared/src/game-settings/building-availability";
import { contextBuildingAvailability } from "../settlement/building-availability-rules";
import { HARBOUR_TYPE_ID } from "../settlement/building-type-ids";
import { featureRefusal } from "../settlement/feature-rules";
import { optionsNow } from "../settlement/game-clock";
import { contextIslandRole } from "../settlement/island-role";
import { addGood } from "../settlement/production-rules";
import { findHomeBuilding, isHomeBuilding, isOwnBuilding } from "../settlement/settlement-home";
import { contextTalents } from "../settlement/settlement-talents";
import type { Goods, SettlementBuilding, SettlementContext } from "../settlement/settlement-types";
import { isSharedStorageWare, storagePoolAt } from "../settlement/shared-storage";
import { uniquePoolSources } from "../settlement/shared-storage-ware-sources";
import { contextPlayerLevel } from "../settlement/sim-rules";
import { contextStorageCapacity, storageContribution, storageRoom } from "../settlement/storage-capacity";
import { creditTradeCustody, hasTradeCustody, tradePaidCustody } from "./trade-custody";
import { pendingTradeIncoming } from "./trade-ledger";
import type {
  SettlementTradeSave, TradeHeldGoods, TradeIslandPort, TradePaidCustody, TradeReservation
} from "./trade-types";


const isFriendlyHarbour = (building: SettlementBuilding) =>
  building.typeId === HARBOUR_TYPE_ID && isOwnBuilding(building);

const harbourStatus = (buildings: readonly SettlementBuilding[]): TradeIslandPort["harbour"] => {
  const harbours = buildings.filter(isFriendlyHarbour);
  if (!harbours.length) return "missing";
  return harbours.some(harbour => harbour.construction === 1) ? "ready" : "unfinished";
};

/** Wares promised to construction sites, ship voyages and Tavern recruits (still in storage). */
const reservedDemand = (context: SettlementContext, ware: string) => context.buildings.reduce((sum, building) => {
  const access = tradeHarbour(context.buildings) ?? findHomeBuilding(context);
  if (access?.storagePoolId !== undefined && context.storagePools &&
    storagePoolAt(context, building.access)?.id !== access.storagePoolId) return sum;
  const construction = building.construction === 1 ? 0 : Math.max(0, (building.required[ware] ?? 0) -
    (building.input[ware] ?? 0) - (building.incoming[ware] ?? 0) - (building.constructionConsumed?.[ware] ?? 0));
  const voyage = context.naval?.expeditionDemand(building.uid)[ware] ?? 0;
  const recruit = context.tavern?.demand(building.uid)[ware] ?? 0;
  return sum + construction + Math.max(0, voyage) + Math.max(0, recruit);
}, 0);

/** Completed friendly storages, harbours first: payments leave from the harbour when it holds the wares. */
const tradeStorages = (buildings: readonly SettlementBuilding[]) => buildings
  .filter(building => storageContribution(building) > 0)
  .sort((a, b) => Number(isFriendlyHarbour(b)) - Number(isFriendlyHarbour(a)));

/**
 * Trading exists only on the home island (owner 2026-10-19): not on a colony (its home harbour, a colony save
 * or colony boot) nor on an adventure island.
 */
export const isTradeHomeIsland = (context: SettlementContext) => {
  if (context.options.homeBuilding === 39 || context.options.homeBuilding === null) return false;
  if (context.buildings.some(building => building.colonyHome)) return false;
  return contextIslandRole(context) === "home";
};

/**
 * The harbour the island trades through: a finished friendly harbour, the colony's home harbour first, else
 * the oldest. Escrow wares are collected there and trade ships call there.
 */
export const tradeHarbour = (buildings: readonly SettlementBuilding[]) => buildings
  .filter(building => isFriendlyHarbour(building) && building.construction === 1)
  .sort((a, b) => Number(Boolean(b.colonyHome)) - Number(Boolean(a.colonyHome)) || a.uid - b.uid)[0];

/** One physical donor pool. An explicit missing harbour never redirects a payment elsewhere. */
export const tradePoolStorages = (buildings: readonly SettlementBuilding[], targetHarbourUid?: number) => {
  const storages = tradeStorages(buildings);
  const target = targetHarbourUid === undefined ? tradeHarbour(buildings) ??
    storages.find(isHomeBuilding) :
    storages.find(storage => storage.uid === targetHarbourUid);
  if (!target) return [];
  const members = storages.filter(storage => storage.storagePoolId === target.storagePoolId);
  return uniquePoolSources([target, ...members.filter(storage => storage !== target)]);
};

export const tradeAvailableStock = (buildings: readonly SettlementBuilding[], ware: string, harbourUid?: number) =>
  tradePoolStorages(buildings, harbourUid).reduce((sum, storage) => sum + (storage.inventory[ware] ?? 0), 0);

/** Plan the complete private escrow first; an insufficient request never partially debits its pool. */
export const reserveFromStorages = (
  buildings: readonly SettlementBuilding[], goods: Readonly<Goods>, targetHarbourUid?: number, context?: SettlementContext
): TradeReservation | null => {
  const storages = tradePoolStorages(buildings, targetHarbourUid);
  const harbourUid = targetHarbourUid ?? tradeHarbour(buildings)?.uid;
  const plan: Array<{ count: number; storage: SettlementBuilding; ware: string }> = [];
  for (const [ware, amount] of Object.entries(goods)) {
    if (!isSharedStorageWare(ware) || !Number.isSafeInteger(amount) || amount < 0) return null;
    let remaining = amount;
    for (const storage of storages) {
      const count = Math.min(remaining, storage.inventory[ware] ?? 0);
      if (count <= 0) continue;
      plan.push({ count, storage, ware }); remaining -= count;
    }
    if (remaining > 0) return null;
  }
  const custody = storages[0] && tradePaidCustody(storages[0], context);
  const reservation: TradeReservation = { ...(custody ? { custody } : {}), held: [], staged: {}, ...(harbourUid === undefined ? {} : { harbourUid }) };
  for (const { count, storage, ware } of plan) {
    addGood(storage.inventory, ware, -count);
    if (storage.uid === harbourUid) addGood(reservation.staged, ware, count);
    else holdAt(reservation.held, storage.uid, ware, count);
  }
  return reservation;
};

const holdAt = (held: TradeHeldGoods[], uid: number, ware: string, amount: number) => {
  const entry = held.find(row => row.uid === uid) ?? held[held.push({ goods: {}, uid }) - 1]!;
  addGood(entry.goods, ware, amount);
};

/** Explicit arrivals keep their named door or donor pool; only unbound new arrivals use the preferred port. */
const storeAtHarbour = (context: SettlementContext, goods: Readonly<Goods>, uid?: number, custody?: TradePaidCustody) => {
  if (custody) {
    const named = context.buildings.find(building => building.uid === uid);
    if (named && !hasTradeCustody(context, named, custody)) return false;
    return creditTradeCustody(context, custody, goods);
  }
  const buildings = context.buildings;
  const named = uid === undefined ? undefined : buildings.find(building => building.uid === uid &&
    storageContribution(building) > 0);
  const target = uid === undefined ? tradeHarbour(buildings) ?? tradeStorages(buildings)[0] : named;
  if (!target) return false;
  for (const [ware, amount] of Object.entries(goods)) addGood(target.inventory, ware, amount);
  return true;
};

/** Held refunds preserve the original pool or surviving named source; they never select another island. */
const releaseHeld = (context: SettlementContext, held: readonly TradeHeldGoods[], custody?: TradePaidCustody) => {
  for (const { goods, uid } of held) storeAtHarbour(context, goods, uid, custody);
};

/** No partial refund: all private held/staged goods have one validated original destination. */
const refundReservation = (context: SettlementContext, reservation: TradeReservation) => {
  const goods: Goods = { ...reservation.staged };
  for (const row of reservation.held) for (const [ware, amount] of Object.entries(row.goods)) addGood(goods, ware, amount);
  if (reservation.custody) return creditTradeCustody(context, reservation.custody, goods);
  // Historical unbound jobs may only use their surviving named door, never an arbitrary replacement.
  const named = context.buildings.find(building => building.uid === reservation.harbourUid &&
    storageContribution(building) > 0);
  if (!named) return false;
  const heldTargets = reservation.held.map(row => ({ row, target: context.buildings.find(building =>
    building.uid === row.uid && storageContribution(building) > 0) }));
  if (heldTargets.some(({ target }) => !target || target.storagePoolId !== named.storagePoolId)) return false;
  for (const { row, target } of heldTargets)
    for (const [ware, amount] of Object.entries(row.goods)) addGood(target!.inventory, ware, amount);
  for (const [ware, amount] of Object.entries(reservation.staged)) addGood(named.inventory, ware, amount);
  return true;
};

/** The island-local port of a settlement (architecture decision 7: stock and capacity per island). */
export const settlementTradePort = (context: SettlementContext, state: SettlementTradeSave): TradeIslandPort => {
  const capacity = () => contextStorageCapacity(context, tradeHarbour(context.buildings) ?? findHomeBuilding(context));
  const free = (ware: string) => tradeAvailableStock(context.buildings, ware) - reservedDemand(context, ware);
  return {
    freeCapacity: ware =>
      storageRoom(capacity(), ware) - pendingTradeIncoming(state, ware),
    freeStock: ware => Math.max(0, free(ware)),
    get featureOff() { return featureRefusal(context, "trade"); },
    get harbour() { return harbourStatus(context.buildings); },
    get nation() { return context.playerNation ?? "roman"; },
    now: () => optionsNow(context.options),
    get homeIsland() { return isTradeHomeIsland(context); },
    /** Read only when a check needs it: the level hook is journalled by recordings. */
    get playerLevel() { return contextPlayerLevel(context) ?? 1; },
    get tierCap() { return availabilityTier(contextBuildingAvailability(context)); },
    get offerLimit() { return TRADE_MAX_ACTIVE_OFFERS + contextTalents(context).tradeOfferSlots; },
    release: (held, custody) => releaseHeld(context, held, custody),
    refund: reservation => refundReservation(context, reservation),
    reserve: goods => reserveFromStorages(context.buildings, goods, undefined, context),
    seed: context.options.world.seed,
    storageFull: ware => {
      const snapshot = capacity();
      return (snapshot.stored[ware] ?? 0) >= snapshot.capacity;
    },
    store: (goods, uid, custody) => storeAtHarbour(context, goods, uid, custody)
  };
};
