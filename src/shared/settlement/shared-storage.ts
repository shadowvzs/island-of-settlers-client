import { isForbiddenKey } from "../../../../island-of-settlers-shared/src/validation/index";
import { STORAGE_IDS } from "./production-rules";
import { landmassAt } from "./settlement-landmass-index";
import { hasEconomy, ownerOf } from "./settlement-ownership";
import { talentsOf } from "./settlement-talents";
import type { Goods, SettlementBuilding, SettlementContext } from "./settlement-types";
import { reconcileStockLandPools } from "./stock-land-pools";
import { contextStockLand, createStockLandResolver, type StockLandLinks } from "./stock-lands";
import { storageContribution } from "./storage-capacity";

/** Equipment is owned by its physical depot even when ordinary wares share a landmass. */
export const isSharedStorageWare = (ware: string) =>
  ware.length > 0 && ware !== "boat" && ware !== "handcart" &&
  !isForbiddenKey(ware) && !ware.startsWith("~");

export interface StoragePool {
  id: number;
  owner: number;
  anchor: number;
  /** Free goods. Jobs and ship preparations have their own saved custody. */
  available: Goods;
  /** Explicit imports requested for this physical island, shared by all its access points. */
  collect?: string[];
  collectHarbourUid?: number;
}

export interface StoragePoolState {
  version: 1;
  nextId: number;
  pools: StoragePool[];
  /** Physical equipment left behind when the final access point is forcibly lost. */
  stranded?: Array<{ owner: number; anchor: number; goods: Goods }>;
}

export interface StoragePoolSnapshot {
  poolId: number;
  available: Readonly<Goods>;
  held: Readonly<Goods>;
  incoming: Readonly<Goods>;
  stored: Readonly<Goods>;
  /** Per-ware limit, summed from access points on this landmass. */
  capacity: number;
}

/** A completed storage of a faction with an economy is an access point of that faction's pool on its land. */
const isAccess = (context: SettlementContext, building: SettlementBuilding) =>
  building.construction === 1 && hasEconomy(context, ownerOf(building)) && STORAGE_IDS.has(building.typeId);
const dryCellOf = (context: SettlementContext, building: SettlementBuilding) => {
  const world = context.options.world;
  for (const point of [building, building.workerApproach, building.doorThreshold, building.access]) {
    if (landmassAt(world, point) < 0) continue;
    return Math.floor(point.z) * world.cellsX + Math.floor(point.x);
  }
  return -1;
};
const anchorOf = dryCellOf;
/** The dry cell a storage's pool membership is judged by (-1 when it has none). */
export const storageDryCell = dryCellOf;
/** Pools follow stock lands: landmasses, joined while a bridge links them (`stock-lands.ts`). */
const landOfAnchor = (context: SettlementContext, anchor: number, resolve = contextStockLand(context)) =>
  resolve(landmassAt(context.options.world, {
    x: anchor % context.options.world.cellsX, z: Math.floor(anchor / context.options.world.cellsX)
  }));
const samePool = (
  context: SettlementContext, pool: StoragePool, building: SettlementBuilding, resolve = contextStockLand(context)
) => {
  if (pool.owner !== ownerOf(building)) return false;
  const land = landOfAnchor(context, pool.anchor, resolve);
  return land >= 0 && land === landOfAnchor(context, dryCellOf(context, building), resolve);
};

export const emptyStoragePools = (): StoragePoolState => ({ version: 1, nextId: 0, pools: [], stranded: [] });

/** Inventory whose shared wares read and write `pool`; local equipment stays in `local`. */
const poolInventoryView = (local: Goods, pool: StoragePool): Goods => new Proxy(local, {
  get(target, key) {
    if (key === "toJSON") return () => ({ ...target });
    if (typeof key === "string" && isSharedStorageWare(key)) return pool.available[key];
    return Reflect.get(target, key);
  },
  set(target, key, value) {
    if (typeof key !== "string" || !isSharedStorageWare(key)) return Reflect.set(target, key, value);
    pool.available[key] = value as number;
    return true;
  },
  deleteProperty(target, key) {
    if (typeof key !== "string" || !isSharedStorageWare(key)) return Reflect.deleteProperty(target, key);
    delete pool.available[key];
    return true;
  },
  ownKeys(target) { return [...new Set([...Reflect.ownKeys(target), ...Object.keys(pool.available)])]; },
  has(target, key) {
    return typeof key === "string" && isSharedStorageWare(key) ? key in pool.available : Reflect.has(target, key);
  },
  getOwnPropertyDescriptor(target, key) {
    if (typeof key !== "string" || !isSharedStorageWare(key)) return Reflect.getOwnPropertyDescriptor(target, key);
    if (!(key in pool.available)) return undefined;
    return { configurable: true, enumerable: true, writable: true, value: pool.available[key] };
  }
});

/**
 * Storage buildings of a saved (archived) island whose inventories use their saved pool, so the
 * colony helpers that only see buildings keep shared wares in the pool. These are copies: the save
 * itself keeps plain JSON-cloneable inventories.
 */
export const savedStorageBuildings = (
  settlement: { buildings: SettlementBuilding[]; storagePools?: StoragePoolState }
): SettlementBuilding[] => settlement.buildings.map(building => {
  const pool = settlement.storagePools?.pools.find(entry => entry.id === building.storagePoolId);
  return pool ? { ...building, inventory: poolInventoryView(building.inventory, pool) } : building;
});

const views = new WeakMap<SettlementBuilding, Goods>();
const viewPools = new WeakMap<SettlementBuilding, StoragePool>();
/** A per-door runtime view keeps legacy contact operations on one balance; JSON contains only local equipment. */
const attachInventoryView = (building: SettlementBuilding, pool: StoragePool) => {
  if (views.get(building) === building.inventory && viewPools.get(building) !== pool) {
    // The pool changed (stock lands joined or split): the local equipment keeps its own balance.
    building.inventory = JSON.parse(JSON.stringify(building.inventory)) as Goods;
    views.delete(building);
  }
  // Warehouse policy buttons were replaced by per-island collection. Hidden saved overrides
  // must not prevent local deliveries or start obsolete automatic exports after a reload. This
  // also runs for an already-attached view so capture removes a policy set during this session.
  for (const policy of [building.accepts, building.exports]) if (policy)
    for (const ware of Object.keys(policy)) if (isSharedStorageWare(ware)) delete policy[ware];
  if (views.get(building) === building.inventory) return;
  const view = poolInventoryView(building.inventory, pool);
  views.set(building, view);
  viewPools.set(building, pool);
  building.inventory = view;
};

/** Build membership from physical terrain, never roads or the unstable component ordinal. */
export const storagePoolFor = (context: SettlementContext, building: SettlementBuilding) => {
  if (!isAccess(context, building)) return undefined;
  if (dryCellOf(context, building) < 0) return undefined;
  return context.storagePools?.pools.find(pool => samePool(context, pool, building));
};

export const storagePoolById = (context: SettlementContext, id: number | undefined) =>
  id === undefined ? undefined : context.storagePools?.pools.find(pool => pool.id === id);

/** Find a saved pool by actual dry land, including when its last access point was removed. */
export const storagePoolAt = (
  context: SettlementContext, point: { x: number; z: number }, owner = 0
) => {
  const resolve = contextStockLand(context);
  const land = resolve(landmassAt(context.options.world, point));
  if (land < 0) return undefined;
  return context.storagePools?.pools.find(pool => pool.owner === owner &&
    landOfAnchor(context, pool.anchor, resolve) === land);
};

export const creditStorageAt = (context: SettlementContext, point: { x: number; z: number },
  ware: string, amount: number) => {
  if (!isSharedStorageWare(ware) || !Number.isSafeInteger(amount) || amount < 0) return false;
  let pool = storagePoolAt(context, point);
  if (!pool) {
    const world = context.options.world;
    if (landmassAt(world, point) < 0) return false;
    const state = context.storagePools ?? (context.storagePools = emptyStoragePools());
    if (!Number.isSafeInteger(state.nextId) || state.nextId >= Number.MAX_SAFE_INTEGER) return false;
    pool = { id: state.nextId++, owner: 0,
      anchor: Math.floor(point.z) * world.cellsX + Math.floor(point.x), available: {} };
    state.pools.push(pool);
  }
  if (!Number.isSafeInteger((pool.available[ware] ?? 0) + amount)) return false;
  pool.available[ware] = (pool.available[ware] ?? 0) + amount;
  return true;
};

export const strandLocalEquipment = (
  context: SettlementContext, building: SettlementBuilding, activeBoatClaims = 0
) => {
  if (!Number.isSafeInteger(activeBoatClaims) || activeBoatClaims < 0 ||
    activeBoatClaims > (building.inventory.boat ?? 0)) return false;
  const goods = Object.fromEntries(Object.entries(building.inventory).flatMap(([ware, amount]) => {
    if (isSharedStorageWare(ware) || !Number.isSafeInteger(amount) || amount <= 0) return [];
    const idle = ware === "boat" ? amount - activeBoatClaims : amount;
    return idle > 0 ? [[ware, idle]] : [];
  }));
  if (!Object.keys(goods).length) {
    if (activeBoatClaims) delete building.inventory.boat;
    return true;
  }
  const anchor = dryCellOf(context, building);
  if (anchor < 0) return false;
  const state = context.storagePools ?? (context.storagePools = emptyStoragePools());
  (state.stranded ??= []).push({ owner: ownerOf(building), anchor, goods });
  for (const ware of Object.keys(goods)) delete building.inventory[ware];
  if (activeBoatClaims) delete building.inventory.boat;
  return true;
};

const recoverStrandedEquipment = (context: SettlementContext, building: SettlementBuilding) => {
  const bins = context.storagePools?.stranded;
  if (!bins?.length) return;
  const land = landOfAnchor(context, dryCellOf(context, building));
  for (let index = bins.length - 1; index >= 0; index--) {
    const bin = bins[index]!;
    if (bin.owner !== ownerOf(building) || landOfAnchor(context, bin.anchor) !== land) continue;
    for (const [ware, amount] of Object.entries(bin.goods))
      building.inventory[ware] = (building.inventory[ware] ?? 0) + amount;
    bins.splice(index, 1);
  }
};

/** Register a newly completed access point once; its previous local balance joins exactly once. */
export const registerStorageAccess = (context: SettlementContext, building: SettlementBuilding) => {
  if (!isAccess(context, building)) {
    if (views.get(building) === building.inventory)
      building.inventory = JSON.parse(JSON.stringify(building.inventory)) as Goods;
    views.delete(building);
    delete building.storagePoolId;
    return undefined;
  }
  if (dryCellOf(context, building) < 0) return undefined;
  const existing = storagePoolFor(context, building);
  if (building.storagePoolId !== undefined) {
    if (!existing || existing.id !== building.storagePoolId) return undefined;
    if (views.get(building) !== building.inventory) for (const [ware, amount] of Object.entries(building.inventory)) {
      if (isSharedStorageWare(ware)) {
        existing.available[ware] = (existing.available[ware] ?? 0) + amount;
        delete building.inventory[ware];
      }
    }
    attachInventoryView(building, existing);
    recoverStrandedEquipment(context, building);
    return existing;
  }
  const state = context.storagePools ?? (context.storagePools = emptyStoragePools());
  if (!existing && (!Number.isSafeInteger(state.nextId) || state.nextId >= Number.MAX_SAFE_INTEGER)) return undefined;
  const pool = existing ?? { id: state.nextId++, owner: ownerOf(building),
    anchor: anchorOf(context, building), available: {} };
  if (!existing) state.pools.push(pool);
  for (const [ware, amount] of Object.entries(building.inventory)) {
    if (isSharedStorageWare(ware)) {
      pool.available[ware] = (pool.available[ware] ?? 0) + amount;
      delete building.inventory[ware];
    }
  }
  building.storagePoolId = pool.id;
  attachInventoryView(building, pool);
  recoverStrandedEquipment(context, building);
  return pool;
};

export const reconcileStorageAccess = (context: SettlementContext) => {
  context.storagePools ??= emptyStoragePools();
  reconcileStockLandPools(context);
  for (const building of context.buildings) registerStorageAccess(context, building);
  for (const pool of context.storagePools?.pools ?? []) {
    if (!pool.collect?.length) continue;
    const hasHarbour = context.buildings.some(building => building.typeId === 39 &&
      storagePoolFor(context, building)?.id === pool.id);
    if (!hasHarbour) {
      pool.collect = [];
      delete pool.collectHarbourUid;
    }
  }
};

/** Explicit terrain edits may rebase only an entirely idle, empty storage network. */
export const canRebaseStorageTerrain = (context: SettlementContext) =>
  (context.storagePools?.pools ?? []).every(pool => Object.values(pool.available).every(count => count === 0)) &&
  !(context.storagePools?.stranded?.length) &&
  context.buildings.every(building => building.storagePoolId === undefined ||
    Object.values(building.incoming).every(count => count === 0) &&
    Object.values(building.shipReserve ?? {}).every(count => count === 0)) &&
  context.actors.every(actor => !actor.delivery && !actor.nextDelivery && !actor.handcart?.trip);

export const rebaseStorageTerrain = (context: SettlementContext) => {
  if (!canRebaseStorageTerrain(context)) return false;
  if (context.roadDecorations?.hasState() && !context.restoringRoadDecorations) context.roadDecorations.invalidate();
  const state = context.storagePools;
  if (!state) return true;
  for (const building of context.buildings) if (building.storagePoolId !== undefined) {
    // The local equipment balance is what each view writes to JSON.
    building.inventory = JSON.parse(JSON.stringify(building.inventory)) as Goods;
    delete building.storagePoolId;
  }
  state.pools = [];
  reconcileStorageAccess(context);
  return true;
};

export const storageAvailable = (context: SettlementContext, building: SettlementBuilding, ware: string) =>
  isSharedStorageWare(ware)
    ? storagePoolFor(context, building)?.available[ware] ?? 0
    : building.inventory[ware] ?? 0;

/** Complete debit/credit at one physical access point, with no copied warehouse balances. */
export const changeStorageAvailable = (
  context: SettlementContext, building: SettlementBuilding, ware: string, delta: number
) => {
  const stock = isSharedStorageWare(ware) ? storagePoolFor(context, building)?.available : building.inventory;
  if (!stock || !Number.isSafeInteger(delta)) return false;
  const next = (stock[ware] ?? 0) + delta;
  if (!Number.isSafeInteger(next) || next < 0) return false;
  if (next) stock[ware] = next;
  else delete stock[ware];
  return true;
};

export const payStorageGoods = (context: SettlementContext, building: SettlementBuilding, goods: Readonly<Goods>) => {
  const entries = Object.entries(goods);
  if (entries.some(([ware, amount]) => !Number.isSafeInteger(amount) || amount < 0 ||
    storageAvailable(context, building, ware) < amount)) return false;
  for (const [ware, amount] of entries) changeStorageAvailable(context, building, ware, -amount);
  return true;
};

export const storageSnapshot = (context: SettlementContext, building: SettlementBuilding): StoragePoolSnapshot | undefined => {
  const pool = storagePoolFor(context, building);
  if (!pool) return undefined;
  const members = context.buildings.filter(site => site.storagePoolId === pool.id && isAccess(context, site));
  const incoming: Goods = {}, held: Goods = {}, stored: Goods = { ...pool.available };
  let capacity = 0;
  const talentBonus = talentsOf(context, pool.owner).storageCapacity;
  for (const member of members) {
    capacity += storageContribution(member, talentBonus, pool.owner);
    for (const [ware, amount] of Object.entries(member.incoming)) if (isSharedStorageWare(ware))
      incoming[ware] = (incoming[ware] ?? 0) + amount;
    for (const [ware, amount] of Object.entries(member.shipReserve ?? {})) if (isSharedStorageWare(ware))
      held[ware] = (held[ware] ?? 0) + amount;
  }
  for (const actor of context.actors) {
    const delivery = actor.delivery;
    if (delivery && !delivery.reserved && !actor.ware &&
      members.some(member => member.uid === delivery.source) && isSharedStorageWare(delivery.ware))
      held[delivery.ware] = (held[delivery.ware] ?? 0) + (actor.wareUnits ?? 1);
    const trip = actor.handcart?.trip;
    if (trip?.prepaid && members.some(member => member.uid === trip.source) && isSharedStorageWare(trip.ware))
      held[trip.ware] = (held[trip.ware] ?? 0) + trip.prepaid;
  }
  for (const [ware, amount] of Object.entries(held)) stored[ware] = (stored[ware] ?? 0) + amount;
  return { poolId: pool.id, available: { ...pool.available }, held, incoming, stored, capacity };
};

/** A saved pool belongs to the player or to a faction running an economy on this island. */
const validPoolOwner = (context: SettlementContext, owner: number) =>
  Number.isSafeInteger(owner) && owner >= 0 && hasEconomy(context, owner);

export const validStoragePools = (
  context: SettlementContext, state: StoragePoolState, buildings: readonly SettlementBuilding[],
  /** The save's own bridges: pool lands follow them, not the island's current roads. */
  links?: StockLandLinks
) => {
  const resolve = links ? createStockLandResolver(context.options.world, links) : contextStockLand(context);
  if (!state || state.version !== 1 || !Number.isSafeInteger(state.nextId) || state.nextId < 0 ||
    !Array.isArray(state.pools)) return false;
  if (state.stranded !== undefined && (!Array.isArray(state.stranded) || state.stranded.some(bin =>
    !bin || !Number.isSafeInteger(bin.owner) || bin.owner < 0 ||
    !Number.isSafeInteger(bin.anchor) || bin.anchor < 0 || landOfAnchor(context, bin.anchor, resolve) < 0 ||
    !bin.goods || typeof bin.goods !== "object" || Array.isArray(bin.goods) ||
    Object.entries(bin.goods).some(([ware, amount]) =>
      isSharedStorageWare(ware) || !Number.isSafeInteger(amount) || amount < 0)))) return false;
  const ids = new Set<number>();
  const landKeys = new Set<string>();
  const collectedWares = new Set<string>();
  for (const pool of state.pools) {
    if (!pool || !Number.isSafeInteger(pool.id) || pool.id < 0 || pool.id >= state.nextId || ids.has(pool.id) ||
      !validPoolOwner(context, pool.owner) || !Number.isSafeInteger(pool.anchor) || pool.anchor < 0 ||
      landOfAnchor(context, pool.anchor, resolve) < 0 || !pool.available || typeof pool.available !== "object" ||
      Array.isArray(pool.available)) return false;
    ids.add(pool.id);
    if (pool.collectHarbourUid !== undefined && (!Number.isSafeInteger(pool.collectHarbourUid) ||
      pool.collectHarbourUid < 0)) return false;
    const collectingSite = buildings.find(building => building?.uid === pool.collectHarbourUid);
    if (collectingSite && (collectingSite.typeId !== 39 || !isAccess(context, collectingSite) ||
      collectingSite.storagePoolId !== pool.id)) return false;
    if (pool.collect !== undefined && (!Array.isArray(pool.collect) ||
      new Set(pool.collect).size !== pool.collect.length ||
      pool.collect.some(ware => typeof ware !== "string" || !isSharedStorageWare(ware)))) return false;
    for (const ware of pool.collect ?? []) {
      if (collectedWares.has(ware)) return false;
      collectedWares.add(ware);
    }
    const landKey = `${pool.owner}:${landOfAnchor(context, pool.anchor, resolve)}`;
    if (landKeys.has(landKey)) return false;
    landKeys.add(landKey);
    if (Object.entries(pool.available).some(([ware, amount]) =>
      !isSharedStorageWare(ware) || !Number.isSafeInteger(amount) || amount < 0)) return false;
  }
  return buildings.every(building => {
    if (!building || typeof building !== "object" || !building.inventory ||
      typeof building.inventory !== "object" || Array.isArray(building.inventory)) return false;
    if (!isAccess(context, building)) return building.storagePoolId === undefined;
    const pool = state.pools.find(entry => entry.id === building.storagePoolId);
    return !!pool && samePool(context, pool, building, resolve) &&
      Object.keys(building.inventory).every(ware => !isSharedStorageWare(ware));
  });
};
