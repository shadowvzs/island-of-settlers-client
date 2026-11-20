import { describe, expect, it } from "vitest";

import { countCompatibleOrePlots, findUsableOrePlots } from "../src/shared/settlement/settlement-ore-placement";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { BUILD, ORE } from "../src/shared/world/world-data";

const fixture = () => {
  const size = 40;
  return { options: { world: {
    cellsX: size, cellsZ: size, heights: new Float32Array((size + 1) ** 2),
    blocking: new Uint8Array(size ** 2), walkCost: new Uint8Array(size ** 2).fill(10),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    mineZone: new Uint16Array(size ** 2), oreAmount: new Uint8Array(size ** 2),
    mineZones: [{ id: 1, ore: ORE.coal }], props: { count: 0 }
  }, roads: {} }, buildings: [], occupied: new Uint8Array(size ** 2), nextBuilding: 0
  } as unknown as SettlementContext;
};

describe("production ore plot capacity", () => {
  it("requires one matching ore cell rather than a full foundation of ore", () => {
    const context = fixture(), world = context.options.world;
    const cell = 20 * world.cellsX + 20;
    world.mineZone[cell] = 1; world.oreAmount[cell] = 1;
    const nextBuilding = context.nextBuilding;
    const plots = findUsableOrePlots(context, [cell], ORE.coal);
    expect(context.nextBuilding).toBe(nextBuilding);
    expect(findUsableOrePlots(context, [cell], ORE.coal, 1)).toHaveLength(1);
    expect(context.nextBuilding).toBe(nextBuilding);
    expect(plots.length).toBeGreaterThan(0);
    expect(plots.every(plot => plot.width * plot.depth === 20)).toBe(true);
    // Many anchors covering one cell still permit only one non-overlapping mine.
    expect(countCompatibleOrePlots(context, plots)).toBe(1);
  });

  it("finds compatible alternatives after the first greedy mine blocks both", () => {
    const context = fixture(), world = context.options.world;
    world.mineZone.fill(1); world.oreAmount.fill(1);
    const plots = [18.5, 14.5, 22.5].map(x => makeBuilding(context, 11, x, 16));
    expect(countCompatibleOrePlots(context, plots, 2)).toBe(2);
  });

  it("preserves existing occupancy and building ownership after capacity measurement", () => {
    const context = fixture(), world = context.options.world;
    world.mineZone.fill(1); world.oreAmount.fill(1);
    const buildings = context.buildings, occupied = context.occupied;
    occupied[0] = 2;
    const copy = occupied.slice();
    const plots = [10.5, 20.5, 30.5].map(x => makeBuilding(context, 11, x, 16));
    expect(countCompatibleOrePlots(context, plots)).toBe(3);
    expect(context.buildings).toBe(buildings);
    expect(context.buildings).toHaveLength(0);
    expect(context.occupied).toBe(occupied);
    expect(context.occupied).toEqual(copy);
  });
});
