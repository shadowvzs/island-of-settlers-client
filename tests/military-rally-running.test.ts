import { expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const fixture = (start = { x: 20, z: 20 }) => {
  const size = 96;
  const world = { seed: 19, cellsX: size, cellsZ: size, seaLevel: -1, start,
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
      scale: new Float32Array() }
  } as unknown as WorldData;
  const roads = createRoadNetwork(world, { isBlocked: () => false });
  const simulation = createSettlementSimulation({ world, roads, homeBuilding: null, initialSettlers: 0 });
  const heavy = simulation.spawnMilitaryOpponent(start, "heavy", 0, 1)!;
  const cavalry = simulation.spawnMilitaryOpponent({ x: start.x, z: start.z + 8 }, "cavalry", 0, 1)!;
  const saved = structuredClone(simulation.saveState());
  for (const soldier of saved.military!.soldiers) soldier.combat!.faction = 0;
  expect(simulation.loadState(saved).ok).toBe(true);
  const ids = [heavy, cavalry];
  const actors = () => ids.map(id => simulation.frames().find(actor => actor.uid === id)!);
  return { actors, cavalry, heavy, ids, simulation };
};

it("runs a long mixed rally at native cavalry speed and running foot speed, surviving reload", () => {
  const { actors, cavalry, heavy, ids, simulation } = fixture();
  expect(simulation.callOutMilitary(["heavy", "cavalry"], { x: 60, z: 24 })).toBe(2);
  const saved = structuredClone(simulation.saveState());
  expect(saved.military!.soldiers.every(soldier => soldier.combat?.rallyRunning)).toBe(true);
  expect(simulation.loadState(saved).ok).toBe(true);
  const before = actors().map(actor => ({ x: actor.x, z: actor.z }));
  simulation.update(.05);
  const moved = actors().map((actor, index) =>
    Math.hypot(actor.x - before[index]!.x, actor.z - before[index]!.z) / .05);
  expect(moved[0]).toBeCloseTo(1.28);
  expect(moved[1]).toBeCloseTo(3.6);
  let heavyArrival = Infinity, cavalryArrival = Infinity;
  for (let tick = 1; tick <= 2400; tick++) {
    simulation.update(.05);
    for (const soldier of simulation.militarySoldiers()) {
      if (soldier.combat?.destination) continue;
      if (soldier.actor === heavy && heavyArrival === Infinity) heavyArrival = tick;
      if (soldier.actor === cavalry && cavalryArrival === Infinity) cavalryArrival = tick;
    }
  }
  expect(cavalryArrival).toBeLessThan(heavyArrival);
  expect(heavyArrival).toBeLessThan(2400);
  expect(simulation.militarySoldiers().filter(soldier => ids.includes(soldier.actor))
    .every(soldier => !soldier.combat?.destination && !soldier.combat?.rallyRunning)).toBe(true);
});

it.each([8, 8.01])("starts running only beyond eight tiles: %s", distance => {
  const { actors, heavy, simulation } = fixture();
  // Keep the single heavy soldier to measure the requested banner distance exactly.
  expect(simulation.callOutMilitary(["heavy"], { x: 20 + distance, z: 20 })).toBe(1);
  const state = simulation.militarySoldiers().find(soldier => soldier.actor === heavy)!.combat!;
  expect(Boolean(state.rallyRunning)).toBe(distance > 8);
  const actor = actors()[0]!, before = { x: actor.x, z: actor.z };
  simulation.update(.05);
  expect(Math.hypot(actor.x - before.x, actor.z - before.z) / .05).toBeCloseTo(distance > 8 ? 1.28 : .8);
});

it("keeps ordinary move orders at the existing formation pace", () => {
  const { ids, simulation } = fixture();
  expect(simulation.commandMilitary(ids, { x: 60, z: 24 }, "move")).toBe(true);
  const states = simulation.militarySoldiers().filter(soldier => ids.includes(soldier.actor));
  expect(states.every(soldier => !soldier.combat?.rallyRunning)).toBe(true);
  expect(states.find(soldier => soldier.combat?.type === "cavalry")!.combat!.marchSpeed).toBeLessThan(1);
});

it("ends travel running when enemy contact interrupts the rally", () => {
  const { actors, heavy, simulation } = fixture();
  simulation.callOutMilitary(["heavy"], { x: 60, z: 20 });
  simulation.update(.05);
  const actor = actors()[0]!;
  expect(simulation.militarySoldiers().find(soldier => soldier.actor === heavy)!.combat!.rallyRunning).toBe(true);
  expect(simulation.spawnMilitaryOpponent({ x: actor.x + 5, z: actor.z }, "shield", 0, 1)).not.toBeNull();
  simulation.update(.05);
  expect(simulation.militarySoldiers().find(soldier => soldier.actor === heavy)!.combat!.rallyRunning)
    .toBeUndefined();
});

it("walks the last two tiles of the foot soldier's rally approach", () => {
  const { actors, simulation } = fixture();
  simulation.callOutMilitary(["heavy"], { x: 28.01, z: 20 });
  const actor = actors()[0]!;
  for (let tick = 0; tick < 200 && Math.hypot(actor.x - 28.01, actor.z - 20) > 1.9; tick++)
    simulation.update(.05);
  const before = { x: actor.x, z: actor.z };
  simulation.update(.05);
  expect(Math.hypot(actor.x - before.x, actor.z - before.z) / .05).toBeCloseTo(.8);
});
