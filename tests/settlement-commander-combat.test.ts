import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { COMMANDER_LODGE_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { commanderMaximumHealth } from "../src/shared/settlement/settlement-commander";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

const deployedCommander = () => {
  const world = huntingWorld();
  const roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({
    developmentAllowed: true, initialSettlers: 20, playerLevel: () => 23, roads, world,
    initialStock: { beer: 40, coins: 40, wine: 40, planks: 40, shield: 6, stone: 40, sword: 6 }
  });
  const [width, depth] = getBuildingDefinition(COMMANDER_LODGE_TYPE_ID).gridFootprint;
  const placed = simulation.placeBuilding(COMMANDER_LODGE_TYPE_ID, 16 + width / 2, 16 + depth / 2);
  if (!placed.ok || !placed.building) throw new Error(placed.reason);
  Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });
  roads.addRoad(simulation.headquarters.access, placed.building.access);
  expect(simulation.recruitCommander(placed.building.uid).ok).toBe(true);
  const saved = simulation.saveState();
  const soldier = saved.military!.soldiers.find(entry => entry.commanderId)!;
  const actor = saved.actors.find(entry => entry.uid === soldier.actor)!;
  soldier.building = -3;
  soldier.combat = { ...soldier.combat!, hp: 1 };
  Object.assign(actor, { building: placed.building.uid, mounted: true, phase: "militaryField", visible: true,
    x: 28, z: 28 });
  saved.military!.commander = { ...saved.military!.commander!, location: "field" };
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  return { actor, lodge: placed.building, saved, simulation, soldier };
};

it("incapacitates a defeated commander instead of killing the roster identity", () => {
  const { actor, lodge, simulation, soldier } = deployedCommander();
  const opponent = simulation.spawnMilitaryOpponent({ x: 31, z: 28 }, "shield");
  expect(opponent).not.toBeNull();
  simulation.commandMilitaryOpponent([opponent!], { x: actor.x, z: actor.z }, 1);
  for (let tick = 0; tick < 20 * 60; tick++) {
    simulation.update(.05);
    if (simulation.commanderState()!.location !== "field") break;
  }
  const state = simulation.commanderState()!;
  expect(["incapacitated", "travelling"]).toContain(state.location);
  const roster = simulation.militarySoldiers().find(entry => entry.commanderId === state.id);
  expect(roster).toBeDefined();
  expect(roster!.combat!.hp).toBe(0);
  expect(simulation.militaryDeaths().some(death => death.id === soldier.actor)).toBe(false);
  expect(simulation.commanderStatus(lodge.uid)!.blockReason).toBeDefined();
});

it("stabilizes an incapacitated commander at 1 HP when it reaches its lodge", () => {
  const { lodge, simulation } = deployedCommander();
  const opponent = simulation.spawnMilitaryOpponent({ x: 31, z: 28 }, "shield");
  simulation.commandMilitaryOpponent([opponent!], { x: 28, z: 28 }, 1);
  for (let tick = 0; tick < 20 * 60 && simulation.commanderState()!.location === "field"; tick++)
    simulation.update(.05);
  for (let tick = 0; tick < 20 * 120 && !["lodge", "recovering"].includes(simulation.commanderState()!.location); tick++)
    simulation.update(.05);
  const state = simulation.commanderState()!;
  expect(state.location).toBe("recovering");
  const commander = simulation.commanderStatus(lodge.uid)!;
  expect(commander.hp).toBe(1);
  expect(commander.maximumHp).toBe(commanderMaximumHealth(1));
  expect(commander.recoverySeconds).toBeGreaterThan(0);
  expect(commander.recoverySeconds).toBeLessThanOrEqual(30 * 60);
  expect(commander.ready).toBe(false);
});
