import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { COLONY_FOODS } from "../../shared/settlement/colony-economy";
import { getBuildingProductionRule } from "../../shared/settlement/production-rules";
import { effectiveProductionSeconds } from "../../shared/settlement/production-timing";
import { isMineType } from "../../shared/settlement/settlement-placement";
import type { ProductionRule, SettlementBuilding } from "../../shared/settlement/settlement-types";
import { type CycleRecord, eventRate } from "./offline-cycle-log";
import { type ChainRecipe, type FlowModel, FOOD_KEY } from "./offline-flow-model";
import type { Counts } from "./offline-ledger-flow";
import { isWoodcutterType, plantedFor, treeKey } from "./offline-tree-harvest";

/** Finished cycles blur a measurement by a few units (a pass-through ware moves between 0 and 3). */
const NOISE_UNITS = 3;
const HUNTER = 22;
/** Walking and resting a chain needs on top of its work, when it never finished a measured cycle. */
const IDLE_OVERHEAD_SECONDS = 60;
/** Plain fishers and quarries work renewable sources (fishing water, resting boulders). */
const SOURCE_KINDS: Readonly<Record<number, string>> = { 18: "fish", 19: "stone" };

/** What the measured span changed on the island. */
export interface MeasuredSpan {
  animals: number;
  /** Goods delivered into a building's input stock (used, plus what its stock grew). */
  delivered: (uid: number) => Counts;
  holdings: Counts;
  records: ReadonlyMap<number, CycleRecord>;
  seconds: number;
  /** Seconds a building's worker waited for inputs. */
  waited: (uid: number) => number;
}

const perCycle = (total: Counts, cycles: number) =>
  Object.fromEntries(Object.entries(total).map(([ware, count]) => [ware, count / cycles]));

/** Finite sources a cycle of this building works: ore, trees, game or a fishing/stone source. */
const sourceInputs = (building: SettlementBuilding): Counts => {
  const inputs: Counts = {};
  if (isMineType(building.typeId)) inputs[`~ore:${building.uid}`] = 1;
  if (isWoodcutterType(building.typeId)) inputs[treeKey(building.typeId)] = 1;
  if (building.typeId === HUNTER) inputs["~animal"] = 1;
  const kind = SOURCE_KINDS[building.typeId];
  if (kind) inputs[`~src:${kind}`] = 1;
  return inputs;
};

const sourceOutputs = (building: SettlementBuilding): Counts => {
  const woodcutter = plantedFor(building.typeId);
  return woodcutter === undefined ? {} : { [treeKey(woodcutter)]: 1 };
};

/** Food a worker that eats any of it took, as one pooled input. */
const pooledInputs = (inputs: Counts, eatsAnyFood: boolean): Counts => {
  if (!eatsAnyFood) return inputs;
  const pooled: Counts = {};
  for (const [ware, count] of Object.entries(inputs)) {
    const key = COLONY_FOODS.includes(ware) ? FOOD_KEY : ware;
    pooled[key] = (pooled[key] ?? 0) + count;
  }
  return pooled;
};

/** Cycles per second by the rule alone: its work plus the walking and resting around it. */
const ruleRate = (cycleSeconds: number) => 1 / (3 * cycleSeconds + IDLE_OVERHEAD_SECONDS);

/** Measured cycles per second, and the rate it could run at while its inputs last. */
const chainRates = (record: CycleRecord | undefined, cycleSeconds: number, seconds: number, waited: number) => {
  const cycles = record?.times.length ?? 0;
  if (!cycles) return { potential: waited >= seconds / 2 ? ruleRate(cycleSeconds) : 0, rate: 0 };
  const rate = eventRate(record!.times, seconds);
  if (waited <= 0) return { potential: rate, rate };
  const busy = cycles / Math.max(seconds - waited, cycles * cycleSeconds);
  return { potential: Math.max(rate, Math.min(busy, ruleRate(cycleSeconds))), rate };
};

/**
 * A charcoal pile takes 24 visits: 6 with logs, 6 covering, burning, 6 uncovering and 6 that each
 * give coal. A short measurement sees only some stages, so the pile's whole yield is used.
 */
const CHARCOAL_CYCLE: CycleRecord = { inputs: { logs: 6 }, outputs: { coal: 6 }, times: new Array(24).fill(0) };
const CHARBURNER = 27;

/** A cycle by the rule, for a chain that waited for inputs the whole measurement. */
const ruleCycle = (rule: ProductionRule): CycleRecord => {
  const record: CycleRecord = { inputs: {}, outputs: {}, times: [0] };
  for (const ware of rule.inputs) record.inputs[ware] = (record.inputs[ware] ?? 0) + 1;
  if (rule.alternativeFood) record.inputs = { [rule.inputs[0]!]: 1 };
  for (const ware of rule.outputs) record.outputs[ware] = 1 / rule.outputs.length;
  return record;
};

/**
 * Cycles per second the deliveries kept up: a chain that ran on its stocked inputs at first gets the
 * share of a scarce ware the carriers actually brought it, not its start-up burst.
 */
const suppliedRate = (inputs: Counts, delivered: Counts, seconds: number) => Object.entries(inputs).reduce(
  (rate, [ware, perCycle]) => Math.min(rate, Math.max(0, delivered[ware] ?? 0) / perCycle / seconds), Infinity);

const chainRecipe = (
  building: SettlementBuilding, rule: ProductionRule, span: MeasuredSpan, measured: CycleRecord | undefined
): ChainRecipe => {
  const record = building.typeId === CHARBURNER ? CHARCOAL_CYCLE : measured ?? ruleCycle(rule);
  const cycles = record.times.length, eatsAnyFood = !!rule.alternativeFood;
  const inputs = pooledInputs(perCycle(record.inputs, cycles), eatsAnyFood);
  const cycleSeconds = effectiveProductionSeconds(rule.seconds, building.typeId);
  const rates = chainRates(measured, cycleSeconds, span.seconds, span.waited(building.uid));
  const supplied = suppliedRate(inputs, pooledInputs(span.delivered(building.uid), eatsAnyFood), span.seconds);
  const rate = Math.min(rates.rate, supplied);
  const scaleCap = span.waited(building.uid) > 0 ? rate * 2 : rates.potential;
  return { inputs: { ...inputs, ...sourceInputs(building) },
    outputs: { ...perCycle(record.outputs, cycles), ...sourceOutputs(building) },
    potential: Math.max(rates.potential, rate), rate, scaleCap, uid: building.uid };
};

/** Net goods change no finished cycle explains (trade, supply ships, upkeep), per second. */
const residualFlow = (span: MeasuredSpan, recipes: readonly CycleRecord[]) => {
  const unexplained: Counts = { ...span.holdings };
  for (const record of recipes) {
    for (const [ware, count] of Object.entries(record.outputs)) unexplained[ware] = (unexplained[ware] ?? 0) - count;
    for (const [ware, count] of Object.entries(record.inputs)) unexplained[ware] = (unexplained[ware] ?? 0) + count;
  }
  const residual: Counts = {};
  for (const [ware, count] of Object.entries(unexplained))
    if (Math.abs(count) > NOISE_UNITS) residual[ware] = count / span.seconds;
  return residual;
};

/** Game the island's hunters find: their kills plus what the wildlife changed, per second. */
const wildlifeRecovery = (span: MeasuredSpan, buildings: ReadonlyMap<number, SettlementBuilding>) => {
  let hunted = 0;
  for (const [uid, record] of span.records) if (buildings.get(uid)?.typeId === HUNTER) hunted += record.times.length;
  return Math.max(0, (span.animals + hunted) / span.seconds);
};

/**
 * The island's chains from one measured span of real ticks: each working building's cycle rate and
 * average cycle, and the leftover steady flows.
 */
export const measuredFlowModel = (
  span: MeasuredSpan, buildings: readonly SettlementBuilding[], nation: WorkerNation
): FlowModel => {
  const byUid = new Map(buildings.map(building => [building.uid, building]));
  const recipes: ChainRecipe[] = [], measured: CycleRecord[] = [];
  let eaters = false;
  // Building order is the carriers' delivery order: scarce goods go to the first users.
  for (const building of buildings) {
    const rule = getBuildingProductionRule(building, nation), record = span.records.get(building.uid);
    if (building.construction !== 1 || !rule || rule.service || (!record && building.worker === undefined)) continue;
    const recipe = chainRecipe(building, rule, span, record);
    if (recipe.potential > 0) recipes.push(recipe);
    eaters ||= !!rule.alternativeFood;
    if (record) measured.push(record);
  }
  const residual = residualFlow(span, measured);
  const game = wildlifeRecovery(span, byUid);
  if (game > 0) residual["~animal"] = game;
  return { food: eaters ? { wares: COLONY_FOODS } : undefined, recipes, residual };
};
