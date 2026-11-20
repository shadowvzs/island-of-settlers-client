import { expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";
const fixture = () => {
  const size = 40;
  const world = { seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 40,
    initialStock: { sword: 24, shield: 24, beer: 24, bow: 4, axe: 4, planks: 48, stone: 48 },
    canWorkerEnterPlot: () => true });
  const advance = (seconds: number) => {
    for (let index = 0; index < seconds * 20; index++) simulation.update(.05);
  };
  // Military buildings take stored soldiers only (new ones come from the Tavern).
  for (let index = 0; index < 12; index++) simulation.recruitStoredMilitary(simulation.headquarters.uid, "shield");

  return { world, simulation, advance };
};

it("plans large rallies one member per step, preserves assigned places and saves pending work", () => {
  const { advance, simulation } = fixture();
  const ids = simulation.militarySoldiers().map(soldier => soldier.actor);
  expect(ids).toHaveLength(12);
  expect(simulation.plantMilitaryRally({ x: 28, z: 28 })).toBe(true);
  expect(simulation.callOutMilitary(["shield"])).toBe(12);
  const saved = simulation.saveState();
  const jobs = saved.military!.combat!.pendingMarches!;
  expect(jobs).toHaveLength(12);
  expect(new Set(jobs.map(job => `${job.goal.x}:${job.goal.z}`)).size).toBe(12);
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  simulation.update(.05);
  expect(simulation.saveState().military!.combat!.pendingMarches).toHaveLength(11);
  advance(45);
  const final = simulation.saveState();
  expect(final.military!.combat!.pendingMarches).toHaveLength(0);
  expect(final.military!.soldiers.every(soldier => !soldier.combat?.order)).toBe(true);
  expect(simulation.loadState(final)).toEqual({ ok: true });
});
it("refuses malformed queued routes atomically", () => {
  const { simulation } = fixture();
  simulation.plantMilitaryRally({ x: 28, z: 28 }); simulation.callOutMilitary(["shield"]);
  const saved = simulation.saveState();
  saved.military!.combat!.pendingMarches![0]!.goal.x = NaN;
  expect(simulation.loadState(saved).ok).toBe(false);
  expect(simulation.saveState().military!.combat!.pendingMarches).toHaveLength(12);
});
