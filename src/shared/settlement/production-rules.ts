import { type BuildingProduction, settlerJob, settlerTool } from "@shared/catalog";
import { buildingsWithRules } from "@shared/catalog/building-data/rules";

import { NATIONS } from "../../../../island-of-settlers-shared/src/nations";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { sawmillProductionRule } from "./sawmill-recipes";
import type { Goods, ProductionRule, SettlementBuilding } from "./settlement-types";

type RuleSource = Pick<BuildingProduction, "alternativeFood" | "inputs" | "job" | "outdoor" | "outputs" | "seconds"
  | "service">;

/**
 * The simulation's rule of a production block (rules sidecar `production`): the job string, the job's tool (its
 * `settler:*` entry), mutable ware lists and the flags. Cycle durations are project tuning.
 */
const toRule = ({ alternativeFood, inputs, job, outdoor, outputs, seconds, service }: RuleSource): ProductionRule => {
  const jobName = settlerJob(job);
  return {
    job: jobName, tool: settlerTool(jobName), inputs: [...inputs], outputs: [...outputs], seconds,
    ...(alternativeFood ? { alternativeFood } : {}),
    ...(outdoor ? { outdoor: outdoor as ProductionRule["outdoor"] } : {}),
    ...(service ? { service } : {})
  };
};

/** Roman rules by building type; nation variants (drink chain slots 5-6) come from `getProductionRule`. */
export const PRODUCTION_RULES: Record<number, ProductionRule> = Object.fromEntries(buildingsWithRules()
  .flatMap(({ entry, rules }) => rules.production ? [[entry.code, toRule(rules.production)]] : []));

/** Per nation, the rules its building variants override (`nations.<nation>.production`). */
const NATION_RULES = Object.fromEntries(NATIONS.map(nation => [nation, Object.fromEntries(buildingsWithRules()
  .flatMap(({ entry, rules }) => {
    const override = rules.nations?.[nation]?.production;
    return override && rules.production ? [[entry.code, toRule({ ...rules.production, ...override })]] : [];
  }))])) as Record<WorkerNation, Record<number, ProductionRule>>;

/** The rule a building type follows for the given nation (Roman rules where no nation differs). */
export const getProductionRule = (typeId: number, nation: WorkerNation = "roman"): ProductionRule | undefined =>
  NATION_RULES[nation]?.[typeId] ?? PRODUCTION_RULES[typeId];
/** Recipe choice affects new cycles and delivery demand, never an already committed worker. */
export const getBuildingProductionRule = (building: SettlementBuilding, nation: WorkerNation = "roman") => {
  const base = getProductionRule(building.typeId, nation);
  return base && sawmillProductionRule(building, base);
};
/** Every rule of every nation, for ware and tool lists that must know all chains. */
export const ALL_PRODUCTION_RULES: readonly ProductionRule[] = [
  ...Object.values(PRODUCTION_RULES),
  ...Object.values(NATION_RULES).flatMap(rules => Object.values(rules))
];
/** Storage buildings (rules sidecar `storage`): headquarters, storehouse and harbour. */
export const STORAGE_IDS: ReadonlySet<number> = new Set(buildingsWithRules()
  .filter(({ rules }) => rules.storage).map(({ entry }) => entry.code));
export const countGoods = (goods: Goods) => Object.values(goods).reduce((sum, value) => sum + value, 0);
export const addGood = (goods: Goods, ware: string, count = 1) => {
  goods[ware] = Math.max(0, (goods[ware] ?? 0) + count);
};
