import { getProductionRule } from "../production-rules";
import { pauseBuildingProduction } from "../settlement-building-policies";
import { buildingNation } from "../settlement-nation";
import { ownerOf } from "../settlement-ownership";
import type { ProductionRule, SettlementBuilding, SettlementContext } from "../settlement-types";
import {
  FORTIFY_POSTURE, GROW_POSTURE, KEEP_PRODUCTION, MAX_EXAMINED_BUILDINGS, PAUSE_PRODUCTION, RUN_PRODUCTION
} from "./constants";
import type { DevelopState } from "./develop-state";
import { steerToolOutput } from "./develop-tools";
import { type EconomyStock, economyWareIndex, freeStock, readEconomyStock, starvedWare } from "./economy-stock";

/** The stock targets of the faction's posture. */
const postureTargets = (stock: EconomyStock, fortify: boolean) =>
  stock.targets[fortify ? FORTIFY_POSTURE : GROW_POSTURE]!;

const anyStarved = (stock: EconomyStock, wares: readonly string[]) => {
  for (const ware of wares) {
    const index = economyWareIndex(ware);
    if (index >= 0 && starvedWare(stock, index)) return true;
  }
  return false;
};

/**
 * The stock target rule (plan §3.6) for a producer's outputs: pause once every output reaches its target, run again
 * once one falls `resumeMargin` below it, keep it as it is in between (no flapping near the target).
 */
const targetChoice = (stock: EconomyStock, outputs: readonly string[], target: Int32Array) => {
  let reached = true;
  for (const ware of outputs) {
    const index = economyWareIndex(ware);
    if (index < 0) return KEEP_PRODUCTION;
    const free = freeStock(stock, index), wanted = target[index]!;
    if (free <= wanted - stock.resumeMargin) return RUN_PRODUCTION;
    if (free < wanted) reached = false;
  }
  return reached ? PAUSE_PRODUCTION : KEEP_PRODUCTION;
};

/**
 * What the manager wants of one producer (pure; plan §3.6):
 * 1. a producer of a ware the build queue starves for runs, whatever its target;
 * 2. a consumer of such a ware pauses, so the carriers bring it to the sites first (construction inputs first);
 * 3. otherwise the stock targets of its outputs decide (a producer without outputs, like the forester, is kept).
 */
export const productionChoice = (stock: EconomyStock, rule: Readonly<ProductionRule>, fortify: boolean) => {
  if (anyStarved(stock, rule.outputs)) return RUN_PRODUCTION;
  if (anyStarved(stock, rule.inputs)) return PAUSE_PRODUCTION;
  if (!rule.outputs.length) return KEEP_PRODUCTION;
  return targetChoice(stock, rule.outputs, postureTargets(stock, fortify));
};

/** The faction's finished producer the manager may steer (a service building is no producer). */
const steerableRule = (context: SettlementContext, building: SettlementBuilding, faction: number) => {
  if (building.construction !== 1 || ownerOf(building) !== faction) return undefined;
  const rule = getProductionRule(building.typeId, buildingNation(context, building));
  return rule && !rule.service ? rule : undefined;
};

const steer = (context: SettlementContext, building: SettlementBuilding, choice: number) => {
  if (choice === KEEP_PRODUCTION) return;
  const paused = choice === PAUSE_PRODUCTION;
  if ((building.productionPaused === true) !== paused) pauseBuildingProduction(context, building, paused);
};

/**
 * The economy manager of a `develop` faction (plan §3.3 economy layer, 1 s; §3.6). It reads the faction's own pools
 * and sites, then steers at most `MAX_EXAMINED_BUILDINGS` of its finished producers from the saved rolling cursor
 * (building uid) on through the player's lever (`productionPaused`). It never writes stock: wares move only by the
 * faction's carriers through its pool, and its settlers come from its own residences and storages.
 */
export const runEconomyDecision = (
  context: SettlementContext, faction: number, develop: DevelopState, stock: EconomyStock
) => {
  readEconomyStock(context, faction, stock);
  let examined = 0;
  for (const building of context.buildings) {
    if (building.uid < develop.cursor) continue;
    const rule = steerableRule(context, building, faction);
    if (!rule) continue;
    steer(context, building, productionChoice(stock, rule, develop.fortify));
    steerToolOutput(stock, building, rule.outputs, postureTargets(stock, develop.fortify));
    if (++examined < MAX_EXAMINED_BUILDINGS) continue;
    develop.cursor = building.uid + 1;
    return;
  }
  develop.cursor = 0;
};
