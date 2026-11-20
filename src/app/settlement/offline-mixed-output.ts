import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { mixedCycleOutput } from "../../shared/settlement/mixed-output";
import { addGood, getBuildingProductionRule } from "../../shared/settlement/production-rules";
import type { Goods, SettlementBuilding } from "../../shared/settlement/settlement-types";
import type { Counts } from "./offline-ledger-flow";

/** The armory follows the player's orders; fields count their cycles differently. */
const OWN_ORDER_TYPES = new Set([5, 24, 27, 37, 60]);

const mixedOutputsOf = (building: SettlementBuilding, nation: WorkerNation) => {
  if (building.construction !== 1 || building.selectedOutput || OWN_ORDER_TYPES.has(building.typeId)) return [];
  const outputs = getBuildingProductionRule(building, nation)?.outputs ?? [];
  return outputs.length > 1 ? outputs : [];
};

/** Finished cycles of each workshop that makes its products in turn or at random (the metalworks). */
export const mixedProducerCycles = (buildings: readonly SettlementBuilding[], nation: WorkerNation) => {
  const cycles: Counts = {};
  for (const building of buildings) if (mixedOutputsOf(building, nation).length) cycles[building.uid] = building.cycle;
  return cycles;
};

/** Every ware such a workshop can make: skips repeat its own product sequence, not the measured mix. */
export const mixedProducerWares = (buildings: readonly SettlementBuilding[], nation: WorkerNation) =>
  new Set(buildings.flatMap(building => mixedOutputsOf(building, nation)));

/** The products of each workshop's next cycles, in its own deterministic order; its cycle count moves on. */
export const runMixedCycles = (
  buildings: readonly SettlementBuilding[], nation: WorkerNation, cycles: Readonly<Counts>
): Goods => {
  const goods: Goods = {};
  for (const building of buildings) {
    const outputs = mixedOutputsOf(building, nation), count = cycles[building.uid] ?? 0;
    if (!outputs.length || count <= 0) continue;
    for (let index = 0; index < count; index++) {
      addGood(goods, mixedCycleOutput(building, outputs));
      building.cycle++;
    }
  }
  return goods;
};
