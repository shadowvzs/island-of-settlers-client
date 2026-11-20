import { landmassAt } from "./settlement-landmass-index";
import { talentsOf } from "./settlement-talents";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";
import { registerStorageAccess, storageDryCell, type StoragePool, type StoragePoolState } from "./shared-storage";
import { contextStockLand, createStockLandResolver, type StockLandResolver } from "./stock-lands";
import { storageContribution } from "./storage-capacity";

/** The resolver whose lands the pools were last reconciled to (derived state, rebuilt after a load). */
const applied = new WeakMap<SettlementContext, StockLandResolver>();

const cellLand = (context: SettlementContext, cell: number, resolve: StockLandResolver) => {
  const width = context.options.world.cellsX;
  return resolve(landmassAt(context.options.world, { x: cell % width, z: Math.floor(cell / width) }));
};

const membersOf = (context: SettlementContext, pool: StoragePool) =>
  context.buildings.filter(building => building.storagePoolId === pool.id);

const memberLand = (context: SettlementContext, building: SettlementBuilding, resolve: StockLandResolver) => {
  const cell = storageDryCell(context, building);
  return cell < 0 ? -1 : cellLand(context, cell, resolve);
};

/** Members on another stock land than the pool's anchor, by land (ascending, members by uid). */
const strayGroups = (context: SettlementContext, pool: StoragePool, resolve: StockLandResolver) => {
  const anchorLand = cellLand(context, pool.anchor, resolve);
  const groups = new Map<number, SettlementBuilding[]>();
  for (const member of membersOf(context, pool).sort((a, b) => a.uid - b.uid)) {
    const land = memberLand(context, member, resolve);
    if (land < 0 || land === anchorLand) continue;
    groups.set(land, [...groups.get(land) ?? [], member]);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b);
};

const capacityOf = (members: readonly SettlementBuilding[], talentBonus: number, owner: number) =>
  members.reduce((sum, member) => sum + storageContribution(member, talentBonus, owner), 0);

/**
 * A bridge came down: the far bank's storages leave the pool with a share of every ware in
 * proportion to their storage capacity (rounded down); the remainder stays on the anchor's side.
 */
const splitPool = (context: SettlementContext, state: StoragePoolState, pool: StoragePool, resolve: StockLandResolver) => {
  const groups = strayGroups(context, pool, resolve);
  if (!groups.length) return;
  const talentBonus = talentsOf(context, pool.owner).storageCapacity;
  const total = capacityOf(membersOf(context, pool), talentBonus, pool.owner);
  const goods = Object.entries(pool.available).sort(([a], [b]) => a.localeCompare(b));
  for (const [, members] of groups) {
    const share = capacityOf(members, talentBonus, pool.owner);
    const split: StoragePool = { anchor: storageDryCell(context, members[0]!), available: {}, id: state.nextId++,
      owner: pool.owner };
    for (const [ware, amount] of goods) {
      const moved = total > 0 ? Math.floor(amount * share / total) : 0;
      if (moved <= 0) continue;
      split.available[ware] = moved;
      pool.available[ware] = (pool.available[ware] ?? 0) - moved;
    }
    if (pool.collectHarbourUid !== undefined && members.some(member => member.uid === pool.collectHarbourUid)) {
      Object.assign(split, { collect: pool.collect ?? [], collectHarbourUid: pool.collectHarbourUid });
      pool.collect = [];
      delete pool.collectHarbourUid;
    }
    state.pools.push(split);
    for (const member of members) member.storagePoolId = split.id;
  }
  for (const [ware, amount] of Object.entries(pool.available)) if (amount === 0) delete pool.available[ware];
};

/** A bridge joined the banks: pools on one stock land merge into the oldest (lowest id). */
const mergePools = (context: SettlementContext, state: StoragePoolState, resolve: StockLandResolver) => {
  const keepers = new Map<string, StoragePool>();
  for (const pool of [...state.pools].sort((a, b) => a.id - b.id)) {
    const key = `${pool.owner}:${cellLand(context, pool.anchor, resolve)}`;
    const keeper = keepers.get(key);
    if (!keeper) { keepers.set(key, pool); continue; }
    for (const [ware, amount] of Object.entries(pool.available))
      keeper.available[ware] = (keeper.available[ware] ?? 0) + amount;
    const collect = [...keeper.collect ?? [], ...(pool.collect ?? []).filter(ware => !keeper.collect?.includes(ware))];
    if (collect.length) keeper.collect = collect;
    if (keeper.collectHarbourUid === undefined && pool.collectHarbourUid !== undefined)
      keeper.collectHarbourUid = pool.collectHarbourUid;
    for (const member of membersOf(context, pool)) member.storagePoolId = keeper.id;
    context.trade?.repointCustody(pool.id, keeper.id);
    context.relief?.repointCustody(pool.id, keeper.id);
    state.pools.splice(state.pools.indexOf(pool), 1);
  }
};

/**
 * Keeps the pools on their stock lands after a bridge was finished or taken down: split first (by
 * capacity), then merge; every storage re-attaches its inventory view to its pool. Free while the
 * lands are unchanged.
 */
export const reconcileStockLandPools = (context: SettlementContext) => {
  const state = context.storagePools;
  if (!state) return;
  const resolve = contextStockLand(context);
  if (applied.get(context) === resolve) return;
  applied.set(context, resolve);
  // A copy: splitting appends the far banks' pools, which need no second pass.
  for (const pool of state.pools.slice()) splitPool(context, state, pool, resolve);
  mergePools(context, state, resolve);
  for (const building of context.buildings) if (building.storagePoolId !== undefined)
    registerStorageAccess(context, building);
};

/**
 * Taking a bridge away must not split a pool that a trade escrow's paid custody holds: the removal
 * finishes once the escrow is done (its storages keep one pool until then).
 */
export const stockSplitBlockedByTrade = (context: SettlementContext, bridgeId: number) => {
  const pools = [...context.trade?.custodyPools() ?? [], ...context.relief?.custodyPools() ?? []];
  if (!pools.length || !context.storagePools) return false;
  const after = createStockLandResolver(context.options.world, {
    removals: context.bridgeRemovals, segments: context.options.roads.segments?.() ?? []
  }, bridgeId);
  return context.storagePools.pools.some(pool => pools.includes(pool.id) &&
    strayGroups(context, pool, after).length > 0);
};
