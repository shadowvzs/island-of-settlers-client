import { SAWMILL_RECIPES, STARTER_STOCK } from "@shared/catalog/balance";

import { ALL_PRODUCTION_RULES, getProductionRule, STORAGE_IDS } from "./production-rules";
import { redirectStorageDeliveries } from "./settlement-delivery-redirect";
import { buildingNation } from "./settlement-nation";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

export const SETTLEMENT_WARES = [...new Set([
  ...Object.keys(STARTER_STOCK),
  ...SAWMILL_RECIPES.flatMap(recipe => [recipe.input, recipe.output]),
  ...ALL_PRODUCTION_RULES.flatMap(rule => [...rule.inputs, ...rule.outputs, ...(rule.tool ? [rule.tool] : [])])
])].sort();

/**
 * Pauses or resumes a finished producer (the player's Pause/Resume, and the economy AI's lever, plan §3.6): the
 * worker finishes a cycle it started; one waiting inside stops at once.
 */
export const pauseBuildingProduction = (context: SettlementContext, building: SettlementBuilding, paused: boolean) => {
  building.productionPaused = paused;
  if (!paused) { building.status = "Production resumed"; return; }
  const worker = context.actors.find(actor => actor.uid === building.worker);
  const waiting = !worker || ["inside", "rest"].includes(worker.phase);
  building.status = waiting ? "Production stopped" : "Finishing current cycle";
  if (waiting) building.working = false;
};

/** Settings affect new work and new deliveries; committed cargo and active work stay owned. */
export const createSettlementBuildingPolicies = (context: SettlementContext) => {
  const setStoragePolicy = (uid: number, ware: string, enabled: boolean, key: "accepts" | "exports") => {
    const building = context.buildings.find(entry => entry.uid === uid);
    if (!building || building.construction !== 1 || !STORAGE_IDS.has(building.typeId) ||
      !SETTLEMENT_WARES.includes(ware)) return false;
    if (key === "exports") building.exports ??= {};
    building[key]![ware] = enabled;
    if (key === "accepts" && !enabled) redirectStorageDeliveries(context, uid, ware);
    return true;
  };
  return {
    setProductionPaused: (uid: number, paused: boolean) => {
      const building = context.buildings.find(entry => entry.uid === uid);
      const rule = building && getProductionRule(building.typeId, buildingNation(context, building));
      if (!building || building.construction !== 1 || !rule || rule.service) return false;
      pauseBuildingProduction(context, building, paused);
      return true;
    },
    setStorageAcceptance: (uid: number, ware: string, accepts: boolean) => setStoragePolicy(uid, ware, accepts, "accepts"),
    setStorageExport: (uid: number, ware: string, enabled: boolean) => setStoragePolicy(uid, ware, enabled, "exports")
  };
};
