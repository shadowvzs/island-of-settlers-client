import { describe, expect, it } from "vitest";

import { grantDebugOutputs } from "../src/shared/settlement/settlement-debug-outputs";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";

const producer = (typeId: number, props: Partial<SettlementBuilding> = {}) => ({
  construction: 1, cycle: 0, incoming: {}, input: {}, inventory: {}, output: {}, typeId, ...props
} as SettlementBuilding);
const context = (buildings: SettlementBuilding[], extra: Partial<SettlementContext> = {}) => ({
  buildings, playerNation: "roman", ...extra
} as SettlementContext);

describe("development output filling", () => {
  it("fills only remaining shelf space with the selected product, without replacing other stock", () => {
    const smith = producer(25, { output: { axe: 2, saw: 1 }, selectedOutput: "pickaxe" });
    const report = grantDebugOutputs(context([smith]));
    expect(smith.output).toEqual({ axe: 2, pickaxe: 3, saw: 1 });
    expect(report).toEqual({ buildings: 1, items: 3, skipped: [] });
    expect(grantDebugOutputs(context([smith])).items).toBe(0);
  });
  it("ignores unfinished, enemy, storage and service buildings", () => {
    const buildings = [producer(25, { construction: .9 }), producer(25, { militaryFaction: 1 }),
      producer(0), producer(7)];
    expect(grantDebugOutputs(context(buildings)).items).toBe(0);
    expect(buildings.every(building => Object.keys(building.output).length === 0)).toBe(true);
  });
  it("uses nation rules and active armory orders while leaving orders, cycle and input untouched", () => {
    const grower = producer(5);
    const armory = producer(24, { cycle: 2, input: { iron: 2 }, productionOrders: { axe: 0, bow: 2 } });
    grantDebugOutputs(context([grower, armory], { playerNation: "viking" }));
    expect(grower.output).toEqual({ honey: 6 });
    expect(armory.output).toEqual({ bow: 6 });
    expect(armory.productionOrders).toEqual({ axe: 0, bow: 2 });
    expect(armory.cycle).toBe(2);
    expect(armory.input).toEqual({ iron: 2 });
  });
  it("never fills a retired building code", () => {
    const retired = producer(38, { worker: 4 });
    const report = grantDebugOutputs(context([retired]));
    expect(report).toEqual({ buildings: 0, items: 0, skipped: [] });
    expect(retired.output).toEqual({});
  });
  it("fills the real cart yard once, without inventing handcart wares or exceeding its capacity", () => {
    const yard = producer(33, { handcartMode: true, handcarts: 1 });
    expect(grantDebugOutputs(context([yard])).items).toBe(0);
    expect(yard.handcarts).toBe(1);
    expect(yard.output).toEqual({});
  });
  it("adds one cart to an empty yard when a completed storage has room", () => {
    const yard = producer(33, { handcartMode: true });
    const depot = producer(0, { handcarts: 0, uid: 1 });
    const island = context([yard, depot], { actors: [] });
    expect(grantDebugOutputs(island).items).toBe(1);
    expect(yard.handcarts).toBe(1);
    expect(yard.output).toEqual({});
  });
  it("reports shipyards rather than inventing boat wares or ships", () => {
    const yard = producer(36);
    const report = grantDebugOutputs(context([yard]));
    expect(report.items).toBe(0);
    expect(report.skipped).toEqual([{ reason: "ships and boats require their normal shipyard launch", typeId: 36 }]);
    expect(yard.output).toEqual({});
  });
});
