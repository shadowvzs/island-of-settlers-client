import { expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const flatWorld = (size: number) => ({ seed: 9, cellsX: size, cellsZ: size, seaLevel: -1,
  start: { x: 5.5, z: 5.5 }, heights: new Float32Array((size + 1) ** 2),
  blocking: new Uint8Array(size ** 2), walkCost: new Uint8Array(size ** 2).fill(10),
  buildClass: new Uint8Array(size ** 2).fill(BUILD.large), oreAmount: new Uint8Array(size ** 2),
  mineZone: new Uint16Array(size ** 2), mineZones: [],
  props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
    scale: new Float32Array() } }) as unknown as WorldData;

it("keeps every member of a twelve-soldier single-leg order after a blocked straight line", () => {
  const world = flatWorld(64);
  for (let z = 24; z < 40; z++) for (let x = 30; x < 33; x++) world.walkCost[z * 64 + x] = 0;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 20, canWorkerEnterPlot: () => true });
  const ids = Array.from({ length: 12 }, (_, index) => simulation.spawnMilitaryOpponent(
    { x: 20 + (index % 4), z: 26 + Math.floor(index / 4) * 4 }, "shield", 0, 1)!);
  expect(simulation.commandMilitaryOpponent(ids, { x: 42, z: 32 }, 1, "move")).toBe(true);
  for (let tick = 0; tick < 24; tick++) simulation.update(.05);
  const frames = simulation.frames();
  const soldiers = simulation.militarySoldiers().filter(soldier => ids.includes(soldier.actor));
  expect(soldiers).toHaveLength(12);
  for (const soldier of soldiers) {
    expect(soldier.combat?.order).toBe("move");
    const actor = frames.find(frame => frame.uid === soldier.actor)!;
    expect(actor.path.length).toBeGreaterThan(0);
  }
});
