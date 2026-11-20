import { expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementCombat } from "../src/shared/settlement/settlement-combat";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { scriptedRandom } from "../src/shared/settlement/simulation-random";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const fixture = () => {
  const size = 40;
  const world = { seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
      scale: new Float32Array() }
  } as unknown as WorldData;
  const roads = createRoadNetwork(world, { isBlocked: () => false });
  const simulation = createSettlementSimulation({ world, roads, homeBuilding: null });
  const advance = (seconds: number) => {
    for (let tick = 0; tick < seconds * 20; tick++) simulation.update(.05);
  };
  return { advance, simulation, world };
};

it("replaces an outdoor landing exit with a new order immediately", () => {
  const { advance, simulation } = fixture();
  const id = simulation.spawnMilitaryOpponent({ x: 10.5, z: 20.5 }, "shield", 0, 1)!;
  const actor = simulation.frames().find(body => body.uid === id)!;
  actor.phase = "militaryLeaving"; actor.path = [{ x: 10.5, z: 25.5 }]; actor.pathIndex = 0;
  actor.queueTarget = { x: 10.5, z: 19.5 }; actor.queueWait = 10;
  expect(simulation.commandMilitaryOpponent([id], { x: 18.5, z: 20.5 }, 1, "move")).toBe(true);
  expect(actor.phase).toBe("militaryField");
  expect(actor.queueTarget).toBeUndefined(); expect(actor.queueWait).toBe(0);
  advance(20);
  expect(Math.hypot(actor.x - 18.5, actor.z - 20.5)).toBeLessThan(.6);
});

it("keeps a landing rider on foot through a passage before mounting on connected open ground", () => {
  const { advance, simulation, world } = fixture();
  for (let z = 0; z < world.cellsZ; z++) if (z !== 20) world.walkCost[z * world.cellsX + 16] = 0;
  const id = simulation.spawnMilitaryOpponent({ x: 10.5, z: 20.5 }, "cavalry", 0, 1)!;
  const saved = structuredClone(simulation.saveState());
  const actor = saved.actors.find(body => body.uid === id)!;
  const combat = saved.military!.soldiers.find(soldier => soldier.actor === id)!.combat!;
  actor.mounted = false; combat.dismounted = true; combat.mountOnClear = true;
  expect(simulation.loadState(saved).ok).toBe(true);
  expect(simulation.commandMilitaryOpponent([id], { x: 24.5, z: 20.5 }, 1, "move")).toBe(true);
  const body = simulation.frames().find(entry => entry.uid === id)!;
  advance(.1); expect(body.mounted).toBe(false);
  advance(5); expect(body.mounted).toBe(false);
  advance(30);
  expect(Math.hypot(body.x - 24.5, body.z - 20.5)).toBeLessThan(.6);
  expect(body.mounted).toBe(true);
});

it("dismounts a legacy adventure rider in place while ordinary cavalry refuses a foot-only order", () => {
  const { simulation, world } = fixture();
  for (let z = 0; z < world.cellsZ; z++) if (z !== 20) world.walkCost[z * world.cellsX + 16] = 0;
  const id = simulation.spawnMilitaryOpponent({ x: 10.5, z: 20.5 }, "cavalry", 0, 1)!;
  const actor = simulation.frames().find(body => body.uid === id)!;
  const destination = { x: 24.5, z: 20.5 };
  expect(simulation.commandMilitaryOpponent([id], destination, 1, "move")).toBe(false);
  expect(actor.mounted).toBe(true);

  const soldier = simulation.militarySoldiers().find(entry => entry.actor === id)!;
  soldier.combat!.faction = 0; actor.home = -1;
  const context = { options: { world }, actors: simulation.frames(), buildings: [],
    occupied: new Uint8Array(world.cellsX * world.cellsZ), reservations: new Set(),
    adventure: { save: () => ({ landing: { gangway: { shore: { x: 10.5, z: 20.5 } } } }) }
  } as unknown as SettlementContext;
  const combat = createSettlementCombat(context, new Map([[id, soldier]]),
    scriptedRandom("military", () => .5));
  const before = { x: actor.x, y: actor.y, z: actor.z };
  const path = combat.prepareLandingDeparture(actor, destination);
  expect(path?.length).toBeGreaterThan(0);
  expect({ x: actor.x, y: actor.y, z: actor.z }).toEqual(before);
  expect(actor.mounted).toBe(false);
  expect(soldier.combat).toMatchObject({ destination, dismounted: true, mountOnClear: true });
});
