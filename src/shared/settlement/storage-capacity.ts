import { BUILDING_LEVEL_STEPS } from "../balance/building-levels";
import { STORAGE_BASE_CAPACITY } from "../balance/economy";
import { catapultAmmoChoice } from "./catapult-ammo-kinds";
import { catapultStoneDemand } from "./military-catapult-resupply";
import { STORAGE_IDS } from "./production-rules";
import { findHomeBuilding, isHomeBuilding } from "./settlement-home";
import { economyOwnerOf, ownerOf, PLAYER_FACTION } from "./settlement-ownership";
import { contextTalents, talentsOf } from "./settlement-talents";
import type { Goods, SettlementBuilding, SettlementContext } from "./settlement-types";
import { isSharedStorageWare, storagePoolFor, storageSnapshot } from "./shared-storage";

/** +25% of the base per level above 1 (building-levels table). */
const upgradeShare = (building: SettlementBuilding) =>
  BUILDING_LEVEL_STEPS.storage * (building.workshopUpgrade?.level ?? 0);
/**
 * Per-ware capacity a completed storage of `owner` adds: its base, its upgrade's share and the storage
 * talent's `talentBonus` share, added together (owner 2026-10-20: bonuses stack additively).
 */
export const storageContribution = (building: SettlementBuilding, talentBonus = 0, owner = PLAYER_FACTION) =>
  building.construction === 1 && ownerOf(building) === owner && STORAGE_IDS.has(building.typeId)
  ? Math.round((STORAGE_BASE_CAPACITY[building.typeId] ?? 0) * (1 + upgradeShare(building) + talentBonus)) : 0;
export interface StorageCapacitySnapshot { capacity: number; stored: Goods; reserved: Goods }
/** Existing physical incoming manifests are the reservation ledger, including after reload. */
export const islandStorageCapacity = (
  buildings: readonly SettlementBuilding[], talentBonus = 0, owner = PLAYER_FACTION
): StorageCapacitySnapshot => {
  const result: StorageCapacitySnapshot = { capacity: 0, stored: {}, reserved: {} };
  const countedPools = new Set<number>();
  for (const building of buildings) {
    const contribution = storageContribution(building, talentBonus, owner);
    if (!contribution) continue;
    result.capacity += contribution;
    const countShared = building.storagePoolId === undefined || !countedPools.has(building.storagePoolId);
    for (const [ware, amount] of Object.entries(building.inventory))
      if (!isSharedStorageWare(ware) || countShared) result.stored[ware] = (result.stored[ware] ?? 0) + amount;
    if (building.storagePoolId !== undefined) countedPools.add(building.storagePoolId);
    for (const [ware, amount] of Object.entries(building.shipReserve ?? {}))
      result.stored[ware] = (result.stored[ware] ?? 0) + amount;
    for (const [ware, amount] of Object.entries(building.incoming)) result.reserved[ware] = (result.reserved[ware] ?? 0) + amount;
  }
  return result;
};
/** The island's capacity with the storage talent of the receiving storage's faction. */
type CapacityContext = Pick<SettlementContext, "buildings" | "talents"> &
  Partial<Pick<SettlementContext, "options" | "storagePools">>;
/**
 * The faction whose capacity a receiving storage counts in: its owner when that faction runs an economy;
 * otherwise the player, so a hostile depot of a `none` faction adds no capacity, exactly as before.
 */
const capacityOwner = (context: CapacityContext, storage: SettlementBuilding) =>
  context.options ? economyOwnerOf(context as Pick<SettlementContext, "options">, storage) : PLAYER_FACTION;
const accessCapacity = (context: CapacityContext, access: SettlementBuilding): StorageCapacitySnapshot => {
  const owner = capacityOwner(context, access);
  const bonus = talentsOf(context, owner).storageCapacity;
  if (context.options && context.storagePools) {
    const full = context as SettlementContext, pool = storagePoolFor(full, access), snapshot = storageSnapshot(full, access);
    if (pool && snapshot) return { stored: { ...snapshot.stored }, reserved: { ...snapshot.incoming },
      capacity: context.buildings.reduce((sum, building) => sum +
        (storagePoolFor(full, building)?.id === pool.id ? storageContribution(building, bonus, owner) : 0), 0) };
  }
  return islandStorageCapacity([access], bonus, owner);
};

/** A command without an explicit receiver targets the active world's home pool. */
export const contextStorageCapacity = (context: CapacityContext, destination?: SettlementBuilding) => {
  const access = destination ?? findHomeBuilding(context);
  if (access && context.options && context.storagePools) return accessCapacity(context, access);
  return islandStorageCapacity(context.buildings, contextTalents(context).storageCapacity);
};
const phases = new WeakMap<SettlementContext, Map<string, StorageCapacitySnapshot>>();
/** One scan per scheduler phase, never per actor/frame. Direct commands obtain a fresh snapshot. */
export const withStorageCapacityPhase = <T>(context: SettlementContext, action: () => T): T => {
  const previous = phases.get(context);
  phases.set(context, new Map());
  try { return action(); } finally { if (previous) phases.set(context, previous); else phases.delete(context); }
};
export const storageRoom = (snapshot: StorageCapacitySnapshot, ware: string) =>
  Math.max(0, snapshot.capacity - (snapshot.stored[ware] ?? 0) - (snapshot.reserved[ware] ?? 0));
const sameSharedPool = (context: SettlementContext, source: SettlementBuilding,
  destination: SettlementBuilding, ware: string) => {
  if (!isSharedStorageWare(ware) || !context.storagePools || !context.options) return false;
  const pool = storagePoolFor(context, source);
  return pool !== undefined && pool.id === storagePoolFor(context, destination)?.id;
};
const receiverKey = (context: SettlementContext, destination: SettlementBuilding, ware: string) => {
  const shared = isSharedStorageWare(ware), pool = context.storagePools && storagePoolFor(context, destination);
  return shared && pool ? `pool:${pool.id}` : `local:${destination.uid}`;
};
const receiverCapacity = (context: SettlementContext, destination: SettlementBuilding, ware: string) => {
  const shared = isSharedStorageWare(ware), pool = context.storagePools && storagePoolFor(context, destination);
  const key = receiverKey(context, destination, ware);
  const phase = phases.get(context);
  let snapshot = phase?.get(key);
  if (!snapshot) {
    const owner = capacityOwner(context, destination);
    snapshot = shared && pool ? accessCapacity(context, destination)
      : islandStorageCapacity([destination], talentsOf(context, owner).storageCapacity, owner);
    phase?.set(key, snapshot);
  }
  return snapshot;
};
export const storageDispatchLimit = (context: SettlementContext, source: SettlementBuilding, destination: SettlementBuilding,
  ware: string, requested: number) => {
  if (sameSharedPool(context, source, destination, ware)) return 0;
  if (destination.typeId === 16) {
    if (destination.construction === 1 && context.military?.buildingStanding?.(destination.uid) === false) return 0;
    // Only the chosen kind is requested; promises of an earlier choice are still accepted on arrival.
    if (destination.construction === 1)
      return ware === catapultAmmoChoice(destination) ? Math.min(requested, catapultStoneDemand(destination)) : 0;
    const capacity = Math.max(0,
      (destination.required?.[ware] ?? 0) - (destination.constructionConsumed?.[ware] ?? 0));
    const room = Math.max(0, capacity - (destination.input[ware] ?? 0) - (destination.incoming[ware] ?? 0));
    return Math.min(requested, room);
  }
  if (!storageContribution(destination, 0, capacityOwner(context, destination))) return requested;
  return Math.min(requested, storageRoom(receiverCapacity(context, destination, ware), ware));
};
/** Called only after the actual actor/cart reservation succeeds. Internal moves are net-neutral. */
export const reserveStorageDispatch = (context: SettlementContext, source: SettlementBuilding,
  destination: SettlementBuilding, ware: string, amount: number) => {
  if (phases.has(context) && storageContribution(destination, 0, capacityOwner(context, destination)) &&
    !sameSharedPool(context, source, destination, ware)) {
    const snapshot = phases.get(context)!.get(receiverKey(context, destination, ware));
    if (snapshot) snapshot.reserved[ware] = (snapshot.reserved[ware] ?? 0) + amount;
    else receiverCapacity(context, destination, ware); // A fresh snapshot already includes the committed incoming.
  }
};

export const canStoreGoods = (buildings: readonly SettlementBuilding[], goods: Readonly<Goods>, talentBonus = 0,
  destination?: SettlementBuilding) => {
  const access = destination ?? buildings.find(isHomeBuilding);
  const members = access?.storagePoolId === undefined ? buildings
    : buildings.filter(building => building.storagePoolId === access.storagePoolId);
  const snapshot = islandStorageCapacity(members, talentBonus);
  const local = access ? islandStorageCapacity([access], talentBonus) : snapshot;
  return Object.entries(goods).every(([ware, amount]) => Number.isSafeInteger(amount) && amount >= 0 &&
    amount <= storageRoom(isSharedStorageWare(ware) ? snapshot : local, ware));
};
