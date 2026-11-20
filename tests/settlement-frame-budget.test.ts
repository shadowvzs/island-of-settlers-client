import { expect, it } from "vitest";

import { settlementFrameDelta } from "../src/app/settlement/settlement-frame-budget";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

it("bounds lag recovery while preserving normal frame time and invalid-delta behavior", () => {
  expect(settlementFrameDelta(1 / 60)).toBe(1 / 60);
  expect(settlementFrameDelta(1)).toBe(.2);
  expect(settlementFrameDelta(60)).toBe(.2);
  for (const value of [-1, Infinity, NaN]) expect(settlementFrameDelta(value)).toBe(0);
});

it("lag recovery runs the same four economy ticks and saves the same cargo and actors", () => {
  const size = 40, world = { seed: 9, cellsX: size, cellsZ: size, seaLevel: -1,
    start: { x: 5.5, z: 5.5 }, heights: new Float32Array((size + 1) ** 2),
    blocking: new Uint8Array(size ** 2), walkCost: new Uint8Array(size ** 2).fill(10),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large), oreAmount: new Uint8Array(size ** 2),
    mineZone: new Uint16Array(size ** 2), mineZones: [], props: { count: 0, types: new Uint8Array(),
      x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() } } as unknown as WorldData;
  const create = () => createSettlementSimulation({ world, roads: createRoadNetwork(world), canWorkerEnterPlot: () => true });
  const roads = createRoadNetwork(world);
  const fixture = createSettlementSimulation({ world, roads, canWorkerEnterPlot: () => true });
  const placed = fixture.placeBuilding(17, 15, 12); if (!placed.ok || !placed.building) throw new Error(placed.reason);
  placed.building.construction = 1; placed.building.required = {}; placed.building.output.logs = 2;
  expect(roads.addRoad(fixture.headquarters.access, placed.building.access)).toBe(true);
  // Save an actual outdoor worker rather than a synthetic timing-only state.
  fixture.update(.7); const saved = fixture.saveState(), baseline = create(), limited = create();
  expect(baseline.loadState(saved)).toEqual({ ok: true });
  expect(saved.actors.length).toBeGreaterThan(0); expect(limited.loadState(saved)).toEqual({ ok: true });
  for (let step = 0; step < 4; step++) baseline.update(.05);
  limited.update(settlementFrameDelta(10));
  const actual = limited.saveState(), expected = baseline.saveState();
  expect(actual.accumulator).toBeCloseTo(expected.accumulator, 12);
  actual.accumulator = expected.accumulator;
  expect(actual).toEqual(expected);
  expect(limited.loadState(limited.saveState())).toEqual({ ok: true });
});
