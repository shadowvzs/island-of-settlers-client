import type { Counts } from "./offline-ledger-flow";

/** One building's measured chain: cycles per second and what an average cycle takes and makes. */
export interface ChainRecipe {
  inputs: Readonly<Counts>;
  outputs: Readonly<Counts>;
  /** Cycles per second it could run while its inputs last (at least `rate`). */
  potential: number;
  /** Measured cycles per second. */
  rate: number;
  /** Optional population-scale cap for a measured carrier-limited chain. */
  scaleCap?: number;
  uid: number;
}

/**
 * The island's measured flows: every building's chain plus the steady net change no cycle explains
 * (trade, supply ships, upkeep), per second. Keys starting with `~` are finite sources, not goods.
 */
export interface FlowModel {
  /** Workers that eat any food (miners) take `~food`, from the first of these wares that is in stock. */
  food?: { wares: readonly string[] };
  recipes: readonly ChainRecipe[];
  residual: Readonly<Counts>;
}

/** The pooled food key and the wares it is drawn from. */
export const FOOD_KEY = "~food";

/** Bounds the solver respects: empty stocks, full storages and buildings that stopped for good. */
export interface FlowBounds {
  capped: ReadonlySet<string>;
  floored: ReadonlySet<string>;
  stopped: ReadonlySet<number>;
}

/** Each chain's cycles per second, and each ware's share of its residual flow. */
export interface FlowScales {
  chains: Map<number, number>;
  /** Food drawn from each ware for the pooled eaters, per second. */
  food: Counts;
  residual: Map<string, number>;
}

const MAX_PASSES = 300;
/** After this many passes each one moves only halfway: chains that bound each other settle between. */
const FREE_PASSES = 10;
const SETTLED = 1e-6;

const supplyAndDemand = (model: FlowModel, scales: FlowScales, ware: string) => {
  let supply = 0, demand = 0;
  for (const recipe of model.recipes) {
    const rate = scales.chains.get(recipe.uid)!;
    supply += rate * (recipe.outputs[ware] ?? 0);
    demand += rate * (recipe.inputs[ware] ?? 0);
  }
  demand += scales.food[ware] ?? 0;
  if (ware === FOOD_KEY) supply += Object.values(scales.food).reduce((sum, draw) => sum + draw, 0);
  const residual = (model.residual[ware] ?? 0) * (scales.residual.get(ware) ?? 1);
  return residual > 0 ? { demand, supply: supply + residual } : { demand: demand - residual, supply };
};

/** Every chain at its potential (a worked out mine at 0), before any bound. */
const unbounded = (model: FlowModel, bounds: FlowBounds): FlowScales => ({ chains: new Map(model.recipes.map(recipe =>
  [recipe.uid, bounds.stopped.has(recipe.uid) ? 0 : recipe.potential])), food: {}, residual: new Map() });

const limit = (scales: FlowScales, uid: number, rate: number) =>
  scales.chains.set(uid, Math.min(scales.chains.get(uid)!, Math.max(0, rate)));

/**
 * Users of an empty ware get what is made of it in the carriers' order: upkeep (building sites,
 * upgrades) first, then the workshops in building order, each up to its current rate.
 */
const shareSupply = (model: FlowModel, current: FlowScales, next: FlowScales, ware: string) => {
  let left = supplyAndDemand(model, current, ware).supply;
  const upkeep = Math.max(0, -(model.residual[ware] ?? 0));
  if (upkeep > 0) {
    next.residual.set(ware, Math.min(1, left / upkeep));
    left -= upkeep * next.residual.get(ware)!;
  }
  for (const recipe of model.recipes) {
    const perCycle = recipe.inputs[ware] ?? 0;
    if (perCycle <= 0) continue;
    const given = Math.min(current.chains.get(recipe.uid)! * perCycle, left);
    limit(next, recipe.uid, given / perCycle);
    left -= given;
  }
};

/** Makers of a ware whose storage is full make only what is used; a several-product workshop slows for its share. */
const slowMakers = (model: FlowModel, current: FlowScales, next: FlowScales, ware: string) => {
  const { demand, supply } = supplyAndDemand(model, current, ware);
  if (supply <= demand) return;
  const factor = demand / supply;
  for (const recipe of model.recipes) {
    const amount = recipe.outputs[ware] ?? 0;
    if (amount <= 0) continue;
    const share = amount / Object.values(recipe.outputs).reduce((sum, count) => sum + count, 0);
    limit(next, recipe.uid, current.chains.get(recipe.uid)! * (1 - share * (1 - factor)));
  }
  if ((model.residual[ware] ?? 0) > 0) next.residual.set(ware, (current.residual.get(ware) ?? 1) * factor);
};

/** What each empty food ware has left after its other users: a stocked ware is unlimited. */
const spareFood = (model: FlowModel, bounds: FlowBounds, current: FlowScales) => {
  const spare: Counts = {}, withoutEaters = { ...current, food: {} };
  for (const ware of model.food!.wares) {
    if (!bounds.floored.has(ware)) continue;
    const { demand, supply } = supplyAndDemand(model, withoutEaters, ware);
    spare[ware] = Math.max(0, supply - demand);
  }
  return spare;
};

/**
 * Feeds the workers that eat any food, in building order, each from the first food ware the carriers
 * find (the rule's order); a worker that gets too little slows down.
 */
const feedEaters = (model: FlowModel, bounds: FlowBounds, current: FlowScales, next: FlowScales) => {
  if (!model.food) return;
  const spare = spareFood(model, bounds, current);
  for (const recipe of model.recipes) {
    const perCycle = recipe.inputs[FOOD_KEY] ?? 0;
    if (perCycle <= 0) continue;
    let missing = current.chains.get(recipe.uid)! * perCycle, eaten = 0;
    for (const ware of model.food.wares) {
      const taken = Math.min(missing, spare[ware] ?? Infinity);
      if (ware in spare) spare[ware]! -= taken;
      next.food[ware] = (next.food[ware] ?? 0) + taken;
      missing -= taken; eaten += taken;
    }
    limit(next, recipe.uid, eaten / perCycle);
  }
};

/** One pass: every chain's rate from its potential and what the bounds give it at the current rates. */
const boundPass = (model: FlowModel, bounds: FlowBounds, current: FlowScales, monotone: boolean) => {
  const next = monotone ? { chains: new Map(current.chains), food: {}, residual: new Map(current.residual) }
    : unbounded(model, bounds);
  for (const ware of [...bounds.floored].sort()) shareSupply(model, current, next, ware);
  for (const ware of [...bounds.capped].sort()) slowMakers(model, current, next, ware);
  feedEaters(model, bounds, current, next);
  return next;
};

const settled = (current: FlowScales, next: FlowScales) => [...next.chains]
  .every(([uid, rate]) => Math.abs(rate - current.chains.get(uid)!) <= SETTLED * Math.max(1e-3, rate));

/** Halfway between two passes. */
const damped = (current: FlowScales, next: FlowScales): FlowScales => ({ ...next,
  chains: new Map([...next.chains].map(([uid, rate]) => [uid, (rate + current.chains.get(uid)!) / 2])) });

/**
 * Bottleneck rates: chains that use an empty stock get what is made of it in delivery order, chains
 * that make a ware whose storage is full make only what is used, and the slowdown passes along each
 * chain; a chain freed from one bound runs again up to its potential.
 */
export const solveFlowScales = (model: FlowModel, bounds: FlowBounds): FlowScales => {
  let scales = unbounded(model, bounds);
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const next = boundPass(model, bounds, scales, false);
    if (settled(scales, next)) break;
    scales = pass < FREE_PASSES ? next : damped(scales, next);
  }
  // A last pass that may only slow chains down keeps every bound.
  return boundPass(model, bounds, scales, true);
};

/** Every key the model moves, in a fixed order. */
export const flowKeys = (model: FlowModel) => {
  const keys = new Set([...Object.keys(model.residual), ...model.food?.wares ?? []]);
  for (const recipe of model.recipes)
    for (const key of [...Object.keys(recipe.inputs), ...Object.keys(recipe.outputs)]) keys.add(key);
  return [...keys].sort();
};

/** Net change per second of every key at the given scales. */
export const netFlow = (model: FlowModel, scales: FlowScales, keys: readonly string[]) => {
  const net: Counts = {};
  for (const key of keys) {
    const { demand, supply } = supplyAndDemand(model, scales, key);
    net[key] = supply - demand;
  }
  return net;
};

/** Finished products per second at the given scales (the player's production statistics). */
export const madeFlow = (model: FlowModel, scales: FlowScales) => {
  const made: Counts = {};
  for (const recipe of model.recipes) {
    const rate = scales.chains.get(recipe.uid)!;
    for (const [ware, count] of Object.entries(recipe.outputs))
      if (!ware.startsWith("~")) made[ware] = (made[ware] ?? 0) + rate * count;
  }
  return made;
};
