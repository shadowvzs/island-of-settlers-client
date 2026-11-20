import { buildingRules } from "@shared/catalog/building-data/rules";

import { BuildingType } from "./building-type-ids";
import type { SettlementBuilding } from "./settlement-types";

/** Armor is made from leather at Leatherworks; the Armory forges weapons and shields only (rules sidecar). */
export const ARMORY_OUTPUTS: readonly string[] = buildingRules(BuildingType.Armory)!.production!.outputs;
/** Equipment that can physically remain in stock or in an already-paid work receipt. */
export const ARMORY_STOCK_WARES: readonly string[] = [...ARMORY_OUTPUTS,
  ...buildingRules(BuildingType.Leatherworks)!.production!.outputs];
export const MAX_ARMORY_ORDER = 9999;
export type ProductionOrders = Record<string, number | null>;

/** Missing orders preserve automatic production for existing games; null means unlimited. */
export const armoryOrder = (building: Pick<SettlementBuilding, "productionOrders">, ware: string) =>
  building.productionOrders?.[ware] ?? null;

export const nextArmoryOutput = (building: SettlementBuilding): string | undefined => {
  for (let offset = 0; offset < ARMORY_OUTPUTS.length; offset++) {
    const ware = ARMORY_OUTPUTS[(building.cycle + offset) % ARMORY_OUTPUTS.length]!;
    const remaining = armoryOrder(building, ware);
    if (remaining === null || remaining > 0) return ware;
  }
  return undefined;
};

/** Sets one ware's order (null: unlimited); an order replaces any chosen single output. */
export const applyArmoryOrder = (building: SettlementBuilding, ware: string, amount: number | null) => {
  building.productionOrders ??= {};
  building.productionOrders[ware] = amount;
  building.selectedOutput = undefined;
};

export const completeArmoryOrder = (building: SettlementBuilding, ware: string) => {
  const remaining = armoryOrder(building, ware);
  if (remaining !== null) building.productionOrders![ware] = Math.max(0, remaining - 1);
  building.cycle = (ARMORY_OUTPUTS.indexOf(ware) + 1) % ARMORY_OUTPUTS.length;
};

export const validArmoryOrders = (value: unknown): value is ProductionOrders => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([ware, count]) =>
    ARMORY_STOCK_WARES.includes(ware) &&
    (count === null || (Number.isSafeInteger(count) && count >= 0 && count <= MAX_ARMORY_ORDER)));
};
