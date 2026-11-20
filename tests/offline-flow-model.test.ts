import { describe, expect, it } from "vitest";

import { eventRate } from "../src/app/settlement/offline-cycle-log";
import { jumpFlows } from "../src/app/settlement/offline-flow-jump";
import {
  type ChainRecipe, flowKeys, type FlowModel, FOOD_KEY, netFlow, solveFlowScales
} from "../src/app/settlement/offline-flow-model";

const chain = (uid: number, rate: number, inputs: Record<string, number>, outputs: Record<string, number>,
  potential = rate): ChainRecipe => ({ inputs, outputs, potential, rate, uid });

const bounds = (floored: string[] = [], capped: string[] = []) =>
  ({ capped: new Set(capped), floored: new Set(floored), stopped: new Set<number>() });

const rounded = (counts: Record<string, number>) =>
  Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Math.round(value * 1000) / 1000]));

// Woodcutter (1 log/s) feeds a sawmill and a charburner that each want 1 log/s.
const forest: FlowModel = { recipes: [
  chain(1, 1, {}, { logs: 1 }), chain(2, 1, { logs: 1 }, { planks: 1 }), chain(3, 1, { logs: 1 }, { coal: 1 })
], residual: {} };

describe("offline flow model", () => {
  it("gives an empty ware to its users in delivery order", () => {
    const scales = solveFlowScales(forest, bounds(["logs"]));
    expect([...scales.chains]).toEqual([[1, 1], [2, 1], [3, 0]]);
    expect(rounded(netFlow(forest, scales, flowKeys(forest)))).toEqual({ coal: 0, logs: 0, planks: 1 });
  });

  it("slows the makers of a ware whose storage is full and passes the slowdown up the chain", () => {
    const model: FlowModel = { recipes: [chain(1, 2, {}, { logs: 1 }), chain(2, 1, { logs: 1 }, { planks: 1 })],
      residual: { planks: -.5 } };
    const scales = solveFlowScales(model, bounds(["logs"], ["planks"]));
    expect(scales.chains.get(2)).toBeCloseTo(.5);
    expect(scales.chains.get(1)).toBe(2);
  });

  it("feeds miners from the first food in stock and lets them share an empty one in order", () => {
    const model: FlowModel = { food: { wares: ["fish", "meat", "bread"] }, recipes: [
      chain(1, .5, {}, { bread: 1 }), chain(2, 1, { [FOOD_KEY]: 1 }, { coal: 1 }),
      chain(3, 1, { [FOOD_KEY]: 1 }, { ironOre: 1 })
    ], residual: {} };
    expect(solveFlowScales(model, bounds()).food).toEqual({ bread: 0, fish: 2, meat: 0 });
    const hungry = solveFlowScales(model, bounds(["fish", "meat", "bread"]));
    expect([...hungry.chains]).toEqual([[1, .5], [2, .5], [3, 0]]);
  });

  it("runs a stock out and re-derives only the bounded chains", () => {
    const result = jumpFlows(forest, { births: { rate: 0, room: 0 }, people: 10, room: () => Infinity, seconds: 100,
      stock: key => key === "logs" ? 30 : 0 });
    // Both log users run until the 30 stocked logs are gone (30 s), then the charburner stops.
    expect(rounded(result.net)).toEqual({ coal: 30, logs: -30, planks: 100 });
    expect(result.cycles.get(3)).toBeCloseTo(30);
    expect(result.seconds).toBe(100);
  });

  it("ends a jump when its births are reached and stops a mine when its ore is dug out", () => {
    const mine: FlowModel = { recipes: [chain(7, 1, { "~ore:7": 1 }, { coal: 1 })], residual: {} };
    const grown = jumpFlows(mine, { births: { rate: .1, room: 3 }, people: 10, room: () => Infinity, seconds: 100,
      stock: key => key === "~ore:7" ? 40 : 0 });
    expect(grown.grown).toBe(true);
    expect(grown.seconds).toBeCloseTo(30);
    const dug = jumpFlows(mine, { births: { rate: 0, room: 0 }, people: 10, room: () => Infinity, seconds: 100,
      stock: key => key === "~ore:7" ? 40 : 0 });
    expect(rounded(dug.net)).toEqual({ coal: 40, "~ore:7": -40 });
  });


  it("measures regular cycles from their gaps and ignores a start-up burst", () => {
    expect(eventRate([5, 15, 25, 35], 40)).toBeCloseTo(.1);
    expect(eventRate([1, 3], 300)).toBe(0);
    expect(eventRate([100], 300)).toBeCloseTo(1 / 300);
  });
});
