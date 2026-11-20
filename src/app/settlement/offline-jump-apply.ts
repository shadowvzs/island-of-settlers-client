import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { addToHome } from "../../shared/settlement/colony-economy";
import { digMineOre } from "../../shared/settlement/settlement-mine-ore";
import { takeFromBuildings } from "../../shared/settlement/settlement-offline-ledger";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { Goods, SettlementBuilding } from "../../shared/settlement/settlement-types";
import type { WorldData } from "../../shared/world/world-data";
import type { FlowJumpResult } from "./offline-flow-jump";
import type { FlowModel } from "./offline-flow-model";
import type { Counts } from "./offline-ledger-flow";
import { sourceUse } from "./offline-ledger-flow";
import { mixedProducerCycles, runMixedCycles } from "./offline-mixed-output";

/** What a jump changes outside the goods: the world's ore and trees, and the player's statistics. */
export interface JumpEffects {
  fellTrees: (ids: readonly number[]) => void;
  /** Mature trees for a `~tree` key, nearest first. */
  fellable: (key: string) => readonly number[];
  onOreChanged?: (cell: number) => void;
  produced: (ware: string) => void;
  simulation: SettlementSimulation;
  /** Units left in each started finite source (fishing water, boulders). */
  sources: Counts;
  world: WorldData;
}

/** Applies whole units: products are stored, used goods leave storages first, then workshop buffers. */
export const moveGoods = (buildings: readonly SettlementBuilding[], change: Readonly<Counts>) => {
  const added: Goods = {}, taken: Goods = {};
  for (const [ware, amount] of Object.entries(change)) {
    const units = Math.round(amount);
    if (units > 0) added[ware] = units;
    else if (units < 0) taken[ware] = -units;
  }
  takeFromBuildings(buildings, taken);
  addToHome(buildings, added);
};

/** Workshops with several products make them in their own deterministic order, not the measured mix. */
const runMixedProducers = (
  model: FlowModel, result: FlowJumpResult, buildings: readonly SettlementBuilding[], nation: WorkerNation,
  goods: Counts
) => {
  const mixed = mixedProducerCycles(buildings, nation), cycles: Counts = {};
  for (const recipe of model.recipes) {
    if (!(recipe.uid in mixed)) continue;
    const count = result.cycles.get(recipe.uid) ?? 0;
    cycles[recipe.uid] = Math.round(count);
    for (const [ware, amount] of Object.entries(recipe.outputs)) goods[ware] = (goods[ware] ?? 0) - amount * count;
  }
  addToHome(buildings, runMixedCycles(buildings, nation, cycles));
};

const digOre = (model: FlowModel, result: FlowJumpResult, effects: JumpEffects) => {
  const byUid = new Map(effects.simulation.buildings().map(building => [building.uid, building]));
  for (const recipe of model.recipes) {
    if (!(`~ore:${recipe.uid}` in recipe.inputs)) continue;
    const dug = Math.round(result.cycles.get(recipe.uid) ?? 0), building = byUid.get(recipe.uid);
    if (dug > 0 && building) for (const cell of digMineOre(effects.world, building, dug)) effects.onOreChanged?.(cell);
  }
};

const worldChanges = (result: FlowJumpResult, effects: JumpEffects) => {
  const resources: Counts = {};
  for (const [key, change] of Object.entries(result.net)) {
    const used = Math.round(-change);
    if (used <= 0) continue;
    if (key.startsWith("~tree")) effects.fellTrees(effects.fellable(key).slice(0, used));
    if (key.startsWith("~src:")) Object.assign(resources, sourceUse(effects.sources, key.slice(5), used));
  }
  return resources;
};

/** Applies a jump's flows to the island: goods, mixed products, ore, trees, sources, births and statistics. */
export const applyJump = (model: FlowModel, result: FlowJumpResult, effects: JumpEffects) => {
  const { simulation } = effects;
  const goods: Counts = {};
  for (const [key, change] of Object.entries(result.net)) if (!key.startsWith("~")) goods[key] = change;
  runMixedProducers(model, result, simulation.buildings(), simulation.playerNation(), goods);
  moveGoods(simulation.buildings(), goods);
  digOre(model, result, effects);
  const resources = worldChanges(result, effects);
  simulation.fastForward({ births: Math.round(result.births), recoverySeconds: result.seconds, resources });
  for (const [ware, count] of Object.entries(result.produced))
    for (let index = Math.round(count); index > 0; index--) effects.produced(ware);
};
