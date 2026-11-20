import { addGood, getProductionRule } from "./production-rules";
import { findHomeBuilding } from "./settlement-home";
import { buildingNation } from "./settlement-nation";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";
import { workshopUpgradeCost } from "./workshop-upgrades";

/** The drink chain's raw producer (5) and drink maker (6). */
const DRINK_CHAIN_TYPES = new Set([5, 6]);

/**
 * Saves from before the drink chains hold wares a building no longer takes (the Vineyard's logs and
 * water): they move to its output so carriers bring them home.
 */
const returnBuildingObsoleteInputs = (context: SettlementContext, building: SettlementBuilding) => {
  const rule = getProductionRule(building.typeId, buildingNation(context, building))!;
  for (const [ware, count] of Object.entries(building.input)) {
    if (rule.inputs.includes(ware) || count <= 0) continue;
    if (building.workshopUpgrade?.level === 0 && ware in workshopUpgradeCost(building)) continue;
    addGood(building.output, ware, count);
    delete building.input[ware];
  }
};

/** On load, and every tick for wares that were still in transit when the game was saved. */
export const returnObsoleteInputs = (context: SettlementContext) => {
  for (const building of context.buildings)
    if (DRINK_CHAIN_TYPES.has(building.typeId) && building.construction === 1)
      returnBuildingObsoleteInputs(context, building);
};

/** The tool goes back to the worker's storage (or the home building when that is gone). */
const returnTool = (context: SettlementContext, actor: SettlementActor) => {
  const storage = context.buildings.find(building => building.uid === actor.home) ?? findHomeBuilding(context);
  if (storage && actor.tool) addGood(storage.inventory, actor.tool);
  actor.tool = undefined;
};

/**
 * Saves from before the drink chains hold workers with another chain's job or tool: they take the
 * nation's job name and swap a tool their rule does not use for the one it needs.
 */
export const retoolDrinkChainWorkers = (context: SettlementContext) => {
  for (const building of context.buildings) {
    if (!DRINK_CHAIN_TYPES.has(building.typeId) || building.worker === undefined) continue;
    const rule = getProductionRule(building.typeId, buildingNation(context, building))!;
    const actor = context.actors.find(entry => entry.uid === building.worker);
    if (!actor) continue;
    actor.job = rule.job;
    if (actor.tool === rule.tool) continue;
    if (actor.tool) returnTool(context, actor);
    const home = context.buildings.find(site => site.uid === actor.home) ?? findHomeBuilding(context);
    if (rule.tool && home && (home.inventory[rule.tool] ?? 0) > 0) {
      addGood(home.inventory, rule.tool, -1);
      actor.tool = rule.tool;
    }
  }
};
