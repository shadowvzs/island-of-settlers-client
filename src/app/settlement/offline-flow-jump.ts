import { deterministicPow } from "../../shared/math/deterministic-math";
import {
  flowKeys, type FlowModel, type FlowScales, madeFlow, netFlow, solveFlowScales
} from "./offline-flow-model";
import type { Counts } from "./offline-ledger-flow";

/** Where the island starts a jump. */
export interface FlowJumpStart {
  /**
   * Settlers born per second, and how many more may be born before the jump ends: more people carry
   * faster, so the island is measured again (at the latest when the population limit is reached).
   */
  births: { rate: number; room: number };
  /** Free storage per ware (Infinity for sources and wares without a limit). */
  room: (key: string) => number;
  /** Game seconds to cover at most. */
  seconds: number;
  /** Units on hand per key: goods in buildings, ore in a mine, fellable trees. */
  stock: (key: string) => number;
  /** People at the jump start and when the rates were measured. */
  people: number;
  calibrationPeople?: number;
  populationStep?: number;
}

/** What a jump did, in whole and fractional units (the caller rounds when it applies them). */
export interface FlowJumpResult {
  births: number;
  /** The jump ended because the births filled its room. */
  grown: boolean;
  /** Finished cycles per building. */
  cycles: Map<number, number>;
  /** Number of piecewise-linear stretches (each ends at an event). */
  events: number;
  /** Net change per key. */
  net: Counts;
  produced: Counts;
  seconds: number;
}

const MAX_STRETCHES = 1000;
/** Rates below this many units per second are treated as zero. */
const EPSILON = 1e-7;

interface JumpState {
  capped: Set<string>;
  floored: Set<string>;
  room: Counts;
  stock: Counts;
  stopped: Set<number>;
}

const addScaled = (total: Counts, rates: Counts, seconds: number) => {
  for (const [key, rate] of Object.entries(rates)) if (rate) total[key] = (total[key] ?? 0) + rate * seconds;
};

/** A bound no longer limits once its ware moves away from it again. */
const releaseBounds = (state: JumpState, net: Counts) => {
  for (const key of state.floored) if ((net[key] ?? 0) > EPSILON) state.floored.delete(key);
  for (const key of state.capped) if ((net[key] ?? 0) < -EPSILON) state.capped.delete(key);
};

type NextEvent = { apply: () => void; seconds: number } | undefined;

const earlier = (current: NextEvent, seconds: number, apply: () => void): NextEvent =>
  current === undefined || seconds < current.seconds ? { apply, seconds: Math.max(0, seconds) } : current;

/** The first stock to run out or storage to fill at the current rates. */
const nextBound = (state: JumpState, keys: readonly string[], net: Counts) => {
  let next: NextEvent;
  for (const key of keys) {
    const rate = net[key] ?? 0;
    if (rate < -EPSILON && !state.floored.has(key))
      next = earlier(next, state.stock[key]! / -rate, () => { state.floored.add(key); state.stock[key] = 0; });
    else if (rate > EPSILON && !state.capped.has(key) && Number.isFinite(state.room[key]))
      next = earlier(next, state.room[key]! / rate, () => { state.capped.add(key); state.room[key] = 0; });
  }
  return next;
};

/** Mines stop for good when their ore is dug out. */
const stopWorkedOut = (model: FlowModel, state: JumpState) => {
  for (const recipe of model.recipes)
    for (const key of Object.keys(recipe.inputs))
      if (key.startsWith("~ore:") && state.floored.has(key)) state.stopped.add(recipe.uid);
};

const advance = (state: JumpState, keys: readonly string[], net: Counts, seconds: number) => {
  for (const key of keys) {
    const change = (net[key] ?? 0) * seconds;
    state.stock[key] = Math.max(0, state.stock[key]! + change);
    if (Number.isFinite(state.room[key])) state.room[key] = Math.max(0, state.room[key]! - change);
  }
};

const addCycles = (cycles: Map<number, number>, model: FlowModel, scales: FlowScales, seconds: number) => {
  for (const recipe of model.recipes) {
    const count = scales.chains.get(recipe.uid)! * seconds;
    if (count) cycles.set(recipe.uid, (cycles.get(recipe.uid) ?? 0) + count);
  }
};

const GROWTH_EXPONENT = 0.6;
const MAX_CARRIER_SCALE = 1;
const peopleScaledModel = (model: FlowModel, people: number, calibrationPeople: number) => {
  if (calibrationPeople < 50 || !model.recipes.some(recipe => (recipe.scaleCap ?? 0) > recipe.rate + 1e-9)) return model;
  const factor = Math.min(MAX_CARRIER_SCALE,
    Math.max(1, deterministicPow(people / Math.max(1, calibrationPeople), GROWTH_EXPONENT)));
  if (factor <= 1 + 1e-9) return model;
  return { ...model, recipes: model.recipes.map(recipe => {
    const cap = recipe.scaleCap ?? recipe.potential;
    if (cap <= recipe.rate + 1e-9 || Object.keys(recipe.inputs).length > 0) return recipe;
    const rate = Math.min(cap, recipe.rate * factor);
    return { ...recipe, rate, potential: Math.max(recipe.potential, rate) };
  }) };
};

/**
 * Integrates the measured chains piecewise linearly: between two events every rate is constant;
 * at an event (a stock runs out, a storage fills, a mine is worked out, the population limit) only
 * the chains it bounds are re-derived, without new measuring. Deterministic.
 */
export const jumpFlows = (model: FlowModel, start: FlowJumpStart): FlowJumpResult => {
  const keys = flowKeys(model);
  const state: JumpState = { capped: new Set(), floored: new Set(), room: {}, stock: {}, stopped: new Set() };
  for (const key of keys) {
    state.stock[key] = start.stock(key);
    state.room[key] = start.room(key);
    if (state.stock[key] < 1) state.floored.add(key);
    if (state.room[key] < 1) state.capped.add(key);
  }
  const result: FlowJumpResult = { births: 0, cycles: new Map(), events: 0, grown: false, net: {}, produced: {},
    seconds: 0 };
  const birthRate = start.births.room > 0 ? start.births.rate : 0;
  let birthRoom = start.births.room;
  const calibrationPeople = Math.max(1, start.calibrationPeople ?? start.people);
  const populationStep = Math.max(0, start.populationStep ?? 10);
  let people = Math.max(1, start.people);
  while (result.seconds < start.seconds && result.events < MAX_STRETCHES && !result.grown) {
    const modelNow = peopleScaledModel(model, people, calibrationPeople);
    stopWorkedOut(modelNow, state);
    const scales = solveFlowScales(modelNow, state);
    const net = netFlow(modelNow, scales, keys);
    releaseBounds(state, net);
    let next = earlier(nextBound(state, keys, net), start.seconds - result.seconds, () => {});
    if (birthRate > 0) next = earlier(next, birthRoom / birthRate, () => { result.grown = true; });
    if (birthRate > 0 && populationStep > 0) {
      const nextStep = (Math.floor(people / populationStep + 1e-9) + 1) * populationStep;
      next = earlier(next, Math.max(1e-9, (nextStep - people) / birthRate), () => {});
    }
    const seconds = Math.min(next!.seconds, start.seconds - result.seconds);
    advance(state, keys, net, seconds);
    addScaled(result.net, net, seconds);
    addScaled(result.produced, madeFlow(modelNow, scales), seconds);
    addCycles(result.cycles, modelNow, scales, seconds);
    const born = birthRate * seconds;
    result.births += born;
    birthRoom -= born;
    people = Math.min(start.people + start.births.room, people + born);
    result.seconds += seconds;
    result.events++;
    next!.apply();
  }
  return result;
};
