import { PROP_REMOVED, type WorldData } from "../world/world-data";
import { storages, takeFromStorages } from "./colony-economy";
import { addGood } from "./production-rules";
import { freshResourceAmount, TREE_TYPES } from "./settlement-resources";
import type { SettlementSaveV1 } from "./settlement-save-state";
import type { Goods, SettlementActor, SettlementBuilding } from "./settlement-types";

const addAll = (total: Goods, goods: Readonly<Goods> | undefined) => {
  for (const [ware, count] of Object.entries(goods ?? {})) addGood(total, ware, count);
};

/** Goods an actor holds: its load, or the inputs it already took for a product still in the making. */
const addActorGoods = (total: Goods, actor: SettlementActor) => {
  if (actor.ware) addGood(total, actor.ware, actor.wareUnits ?? 1);
  else if (actor.productionOutput) addAll(total, actor.consumed);
};

/**
 * Every ware the island holds, wherever it is: building stocks, loads in transit, inputs paid into
 * a product in the making and ship cargo. Production only converts between these, so the totals
 * change by finished cycles, not by goods walking around.
 */
export const islandHoldings = (state: SettlementSaveV1): Goods => {
  const total: Goods = {};
  addAll(total, buildingGoods(state.buildings));
  addPoolGoods(total, state);
  for (const actor of state.actors) addActorGoods(total, actor);
  for (const ship of state.naval.fleet.ships) addAll(total, ship.cargo);
  return total;
};

/**
 * Free storage stock. Shared wares live in the storage pools; a saved storage `inventory` keeps
 * only its local wares, so a ledger built from a save must add the pools once each.
 */
const addPoolGoods = (total: Goods, state: SettlementSaveV1) => {
  for (const pool of state.storagePools?.pools ?? []) addAll(total, pool.available);
  return total;
};

/** Goods in a saved island's buildings, including the shared storage pools. */
export const savedBuildingGoods = (state: SettlementSaveV1): Goods =>
  addPoolGoods(buildingGoods(state.buildings), state);

/** Free goods in a saved island's storages, including the shared storage pools. */
export const savedStoredGoods = (state: SettlementSaveV1): Goods =>
  addPoolGoods(storedGoods(state.buildings), state);

/** Goods in any building: storages, workshop inputs and outputs. */
export const buildingGoods = (buildings: readonly SettlementBuilding[]): Goods => {
  const total: Goods = {};
  for (const building of buildings) {
    addAll(total, building.inventory);
    addAll(total, building.input);
    addAll(total, building.output);
  }
  return total;
};

const takeFromSlots = (slots: Goods[], ware: string, wanted: number) => {
  let remaining = wanted;
  for (const slot of slots.sort((a, b) => (b[ware] ?? 0) - (a[ware] ?? 0))) {
    const taken = Math.min(remaining, slot[ware] ?? 0);
    if (taken <= 0) break;
    addGood(slot, ware, -taken);
    remaining -= taken;
  }
};

/** Takes goods from the storages first, then from workshop buffers (largest first). */
export const takeFromBuildings = (buildings: readonly SettlementBuilding[], wanted: Goods) => {
  const taken = takeFromStorages(buildings, wanted);
  const slots = buildings.flatMap(building => [building.input, building.output, building.inventory]);
  for (const [ware, count] of Object.entries(wanted)) takeFromSlots(slots, ware, count - (taken[ware] ?? 0));
};

/** Goods in the island's completed storages. */
export const storedGoods = (buildings: Parameters<typeof storages>[0]): Goods => {
  const total: Goods = {};
  for (const building of storages(buildings)) addAll(total, building.inventory);
  return total;
};

const buildingShape = (building: SettlementBuilding) => [building.uid, building.typeId,
  building.construction === 1 ? "done" : building.construction.toFixed(3), building.worker === undefined ? "-" : "w",
  building.workshopUpgrade?.level ?? 0, building.productionPaused ? "p" : ""].join(":");

/** Hostile soldiers on the island, idle camps included (the optional old rule keeps them in real ticks). */
export const hostileSoldiers = (state: SettlementSaveV1) =>
  state.military?.soldiers.filter(soldier => (soldier.combat?.faction ?? 0) !== 0).length ?? 0;

/**
 * Soldiers per side and their active total health: any field fight, death or recruit changes it, so
 * offline time with a battle is always ticked. Resting reserves and garrisons are excluded because
 * their eligible healing is deterministic and must not invalidate a measured steady window. Enemy
 * blows at civilians outside buildings (wounds and casualties, MIL-ASSAULT) count as a fight too.
 */
const militaryShape = (state: SettlementSaveV1) => {
  const soldiers = state.military?.soldiers ?? [];
  const actors = new Map(state.actors.map(actor => [actor.uid, actor]));
  const hostile = hostileSoldiers(state);
  const health = soldiers.reduce((sum, soldier) => {
    const phase = actors.get(soldier.actor)?.phase;
    if (phase === "militaryReserve" || phase === "garrison") return sum;
    return sum + (soldier.combat?.hp ?? 0);
  }, 0);
  const combat = state.military?.combat;
  const wounds = combat?.woundedCivilians?.reduce((sum, entry) => sum + entry.hp, 0) ?? 0;
  return `soldiers:${soldiers.length}:${hostile}:${health}:civilians:${combat?.civilianDeaths ?? 0}:${wounds}`;
};

/**
 * The island's shape: buildings, construction, staffing, soldiers and expedition states. Steady rates are
 * only measured, and extrapolated, while it stays the same.
 */
export const islandStructure = (state: SettlementSaveV1) => [
  state.buildings.map(buildingShape).join(","),
  militaryShape(state),
  `colony:${state.colony?.status ?? ""}`, `adventure:${state.adventure?.status ?? ""}`
].join("|");

/**
 * Finite sources worked through the settlement (fishing sites): units used per kind, and units left
 * in each source already started. Trees are counted as standing instead.
 */
export const workedResources = (state: SettlementSaveV1) => {
  const left: Record<string, number> = {}, used: Record<string, number> = {};
  for (const [key, amount] of state.resourceAmounts) {
    const kind = key.slice(0, key.indexOf(":"));
    if (kind === "tree") continue;
    left[key] = amount;
    used[kind] = (used[kind] ?? 0) + freshResourceAmount(kind) - amount;
  }
  return { left, used };
};

/** Trees on the island, any age: a forest that shrinks is never extrapolated. */
export const standingTrees = (world: WorldData) => {
  let count = 0;
  for (let id = 0; id < world.props.count; id++) {
    const type = world.props.types[id]!;
    if (type !== PROP_REMOVED && TREE_TYPES.has(type)) count++;
  }
  return count;
};
