import { PRODUCTION_OUTPUT_CAPACITY } from "../balance/economy";
import { nextArmoryOutput } from "./armory-orders";
import { mixedCycleOutput } from "./mixed-output";
import { addGood, countGoods, getBuildingProductionRule } from "./production-rules";
import { isOwnBuilding } from "./settlement-home";
import { canCraftHandcart, finishHandcart, isCraftingHandcarts } from "./settlement-sawmill-handcarts";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

export interface DebugOutputsReport {
  buildings: number;
  items: number;
  skipped: Array<{ reason: string; typeId: number }>;
}

const ordinaryOutput = (context: SettlementContext, building: SettlementBuilding) => {
  const rule = getBuildingProductionRule(building, context.playerNation);
  if (!rule?.outputs.length || rule.service) return undefined;
  if (building.selectedOutput && rule.outputs.includes(building.selectedOutput)) return building.selectedOutput;
  if (building.typeId === 24) return nextArmoryOutput(building);
  return mixedCycleOutput(building, rule.outputs);
};

/** Fills one producer's free shelf space; retired building codes have no rule and are skipped. */
const grantOrdinaryOutput = (building: SettlementBuilding, context: SettlementContext, report: DebugOutputsReport) => {
  const ware = ordinaryOutput(context, building);
  if (!ware) return;
  const count = Math.max(0, PRODUCTION_OUTPUT_CAPACITY - countGoods(building.output));
  if (!count) return;
  addGood(building.output, ware, count);
  report.buildings++; report.items += count;
};

/** Development-only grants: real shelves and cart queues, without production or quest credit. */
export const grantDebugOutputs = (context: SettlementContext): DebugOutputsReport => {
  const report: DebugOutputsReport = { buildings: 0, items: 0, skipped: [] };
  for (const building of context.buildings) {
    if (building.construction < 1 || !isOwnBuilding(building)) continue;
    const rule = getBuildingProductionRule(building, context.playerNation);
    if (!rule?.outputs.length || rule.service) continue;
    if (building.typeId === 36) {
      report.skipped.push({ reason: "ships and boats require their normal shipyard launch", typeId: building.typeId });
      continue;
    }
    if (isCraftingHandcarts(building)) {
      if (!canCraftHandcart(context, building)) continue;
      finishHandcart(building);
      report.buildings++; report.items++;
      continue;
    }
    grantOrdinaryOutput(building, context, report);
  }
  return report;
};
