import { COLONY_MATERIAL_WARES } from "@shared/catalog/balance";

import { COLONY_ORE_PER_MINE_HOUR } from "../balance/colonies";
import { colonyUpgradeReserve } from "./colony-advanced-material-trade";
import { addGood, getProductionRule, STORAGE_IDS } from "./production-rules";
import { isHomeBuilding, isOwnBuilding, isOwnHeadquarters } from "./settlement-home";
import { ownerOf } from "./settlement-ownership";
import type { Goods, SettlementBuilding } from "./settlement-types";
import { isSharedStorageWare } from "./shared-storage";
import { homePoolSources } from "./shared-storage-ware-sources";

export const COLONY_FOODS: readonly string[] = ["fish", "meat", "bread"];
/** "food" in a demand means any of the miners' foods. */
export const FOOD = "food";
const MINE_IDS = new Set([10, 11, 12, 13]);
const MINE_FOOD_BUFFER = 4;
const SUPPLY_CAP = 40;
/** Kept in colony storage so a new building can always be placed. */
const BUILD_RESERVE = 10;
const BUILD_WARES = ["planks", "stone"] as const;

type StoredBuilding = Pick<SettlementBuilding, "construction" | "inventory" | "typeId"> &
  Partial<Pick<SettlementBuilding, "colonyHome" | "input" | "incoming" | "required" |
    "constructionConsumed" | "storagePoolId" | "worker" | "foundationProgress" | "militaryFaction" | "workshopUpgrade">>;

/** Completed storages (headquarters, warehouses, colony harbour), in building order. */
export const storages = <Building extends StoredBuilding>(buildings: readonly Building[]) =>
  buildings.filter(building => building.construction === 1 && STORAGE_IDS.has(building.typeId) &&
    isOwnBuilding(building));
const stored = (buildings: readonly StoredBuilding[], ware: string) =>
  homePoolSources(storages(buildings)).reduce((sum, building) => sum + (building.inventory[ware] ?? 0), 0);
const storedFood = (buildings: readonly StoredBuilding[]) =>
  COLONY_FOODS.reduce((sum, ware) => sum + stored(buildings, ware), 0);

export const completedMines = (buildings: readonly StoredBuilding[]) =>
  buildings.filter(building => building.construction === 1 && MINE_IDS.has(building.typeId)).length;

/** Worker tools, building wares for its sites plus a reserve, and food for its mines. */
export const colonySupplyDemand = (buildings: readonly StoredBuilding[]): Goods => {
  const demand: Goods = {};
  const tools: Goods = {};
  for (const building of buildings) {
    if (ownerOf(building) > 0 || STORAGE_IDS.has(building.typeId) ||
      [1, 2, 4, 9].includes(building.typeId)) continue;
    const tool = getProductionRule(building.typeId)?.tool;
    // A construction worker has not equipped the future production worker yet.
    if (tool && (building.construction < 1 || building.worker === undefined)) addGood(tools, tool, 1);
    if (building.construction < 1 && building.worker === undefined)
      addGood(tools, (building.foundationProgress ?? 1) < 1 ? "shovel" : "hammer", 1);
  }
  for (const [tool, count] of Object.entries(tools)) {
    const missing = Math.min(SUPPLY_CAP, count - stored(buildings, tool));
    if (missing > 0) demand[tool] = missing;
  }
  for (const ware of BUILD_WARES) {
    const missing = buildings.filter(building => building.construction < 1).reduce((sum, building) =>
      sum + Math.max(0, (building.required?.[ware] ?? 0) - (building.input?.[ware] ?? 0) -
        (building.incoming?.[ware] ?? 0) - (building.constructionConsumed?.[ware] ?? 0)), 0);
    const wanted = Math.min(SUPPLY_CAP, Math.max(missing, BUILD_RESERVE) - stored(buildings, ware));
    if (wanted > 0) demand[ware] = wanted;
  }
  for (const ware of COLONY_MATERIAL_WARES) {
    const missing = Math.min(SUPPLY_CAP, colonyUpgradeReserve(buildings, ware) - stored(buildings, ware));
    if (missing > 0) demand[ware] = missing;
  }
  const mines = buildings.filter(building => building.construction === 1 && MINE_IDS.has(building.typeId));
  const atMines = mines.reduce((sum, mine) =>
    sum + COLONY_FOODS.reduce((inner, ware) => inner + (mine.input?.[ware] ?? 0), 0), 0);
  const food = Math.min(SUPPLY_CAP, mines.length * MINE_FOOD_BUFFER - atMines - storedFood(buildings));
  if (food > 0) demand[FOOD] = food;
  return demand;
};

/** Removes up to the wanted goods from the storages ("food" from any food); returns what was taken. */
export const takeFromStorages = (buildings: readonly StoredBuilding[], wanted: Goods): Goods => {
  const taken: Goods = {};
  for (const [request, count] of Object.entries(wanted)) {
    let remaining = count;
    for (const ware of request === FOOD ? COLONY_FOODS : [request]) for (const storage of isSharedStorageWare(ware) ? homePoolSources(storages(buildings)) :
      storages(buildings).filter(storage => storage === homeStorage(buildings))) {
      const amount = Math.min(remaining, storage.inventory[ware] ?? 0);
      if (amount <= 0) continue;
      addGood(storage.inventory, ware, -amount);
      addGood(taken, ware, amount);
      remaining -= amount;
    }
  }
  return taken;
};

/** The island's home building: headquarters, colony harbour, or else the first finished storage. */
export const homeStorage = <Building extends StoredBuilding>(buildings: readonly Building[]) => {
  const complete = storages(buildings);
  return complete.find(isOwnHeadquarters) ?? complete.find(isHomeBuilding) ??
    (complete.some(building => building.storagePoolId !== undefined) ? undefined : complete[0]);
};

/** Delivered goods go to the island's home building (headquarters or colony harbour). */
export const addToHome = (buildings: readonly StoredBuilding[], goods: Goods) => {
  const home = homeStorage(buildings);
  if (!home) return false;
  for (const [ware, count] of Object.entries(goods)) addGood(home.inventory, ware, count);
  return true;
};

/** Off-screen ore for whole hours: every mine needs one food per ore from the home island. */
export const abstractOreShipment = (mines: number, hours: number, foodAvailable: number) => {
  const ore = Math.min(mines * COLONY_ORE_PER_MINE_HOUR * hours, foodAvailable);
  return { food: ore, ore };
};
