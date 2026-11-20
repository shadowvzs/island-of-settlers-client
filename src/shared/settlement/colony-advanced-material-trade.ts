import { COLONY_MATERIAL_WARES } from "@shared/catalog/balance";

import { STORAGE_IDS } from "./production-rules";
import { isOwnBuilding } from "./settlement-home";
import type { Goods, SettlementBuilding } from "./settlement-types";
import { homePoolSources } from "./shared-storage-ware-sources";
import { workshopUpgradeCost } from "./workshop-upgrades";

type TradeBuilding = Pick<SettlementBuilding, "construction" | "inventory" | "typeId"> &
  Partial<Pick<SettlementBuilding, "input" | "incoming" | "colonyHome" | "militaryFaction" | "storagePoolId" | "workshopUpgrade">>;

/** Upgrade materials stay on their colony until the requested reserve has been delivered. */
export const colonyUpgradeReserve = (buildings: readonly TradeBuilding[], ware: string) => {
  return buildings.reduce((sum, building) => {
    const upgrade = building.workshopUpgrade;
    if (!upgrade?.requested) return sum;
    const cost = workshopUpgradeCost(building)[ware] ?? 0;
    const stock = upgrade.reserved ?? building.input ?? {};
    const promised = upgrade.reserved ? upgrade.incoming ?? {} : building.incoming ?? {};
    return sum + Math.max(0, cost - (stock[ware] ?? 0) - (promised[ware] ?? 0));
  }, 0);
};

/** Every advanced material the colony's storages can export now (above the upgrade reserve): one ship takes it all. */
export const colonyAdvancedCargo = (buildings: readonly TradeBuilding[]): Goods => {
  const goods: Goods = {};
  for (const ware of COLONY_MATERIAL_WARES) {
    const stored = homePoolSources(buildings.filter(building =>
      building.construction === 1 && STORAGE_IDS.has(building.typeId) && isOwnBuilding(building))).reduce((sum, building) => sum + (building.construction === 1 &&
      STORAGE_IDS.has(building.typeId) ? building.inventory[ware] ?? 0 : 0), 0);
    const amount = Math.max(0, stored - colonyUpgradeReserve(buildings, ware));
    if (amount) goods[ware] = amount;
  }
  return goods;
};
