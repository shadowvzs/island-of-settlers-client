import { expect } from "vitest";

import { COMMANDER_INPUT_BUTTON, type CommanderInput } from "../../../island-of-settlers-shared/src/commander-input";
import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import type { WorkerNation } from "../../src/render-common/workers/worker-unit";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { commanderRecruitCost } from "../../src/shared/settlement/settlement-commander";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./hunting-world";

/** A normal catalogue recruit, then a bounded deployed snapshot for combat protocol checks. */
export const commanderProfileSession = (nation: WorkerNation, mounted: boolean) => {
  const world = huntingWorld();
  const roads = createRoadNetwork(world);
  const cost = commanderRecruitCost(nation);
  const simulation = createSettlementSimulation({
    clockStart: 0, developmentAllowed: true, initialSettlers: 20,
    initialStock: { ...Object.fromEntries(Object.keys(cost).map(ware => [ware, 40])), cloth: 40, planks: 40, stone: 40 },
    playerLevel: () => 23, playerNation: nation, roads, world
  });
  const [width, depth] = getBuildingDefinition(62).gridFootprint;
  const placed = simulation.placeBuilding(62, 26 + width / 2, 22 + depth / 2);
  if (!placed.ok || !placed.building) throw new Error(placed.reason);
  Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });
  roads.addRoad(simulation.headquarters.access, placed.building.access);
  expect(simulation.recruitCommander(placed.building.uid).ok).toBe(true);
  const deployed = simulation.saveState();
  const soldier = deployed.military!.soldiers.find(row => row.commanderId)!;
  const actor = deployed.actors.find(row => row.uid === soldier.actor)!;
  Object.assign(actor, { phase: "militaryField", visible: true, mounted: true, x: 40, z: 40, yaw: 0 });
  soldier.building = -3;
  deployed.military!.commander!.location = "field";
  expect(simulation.loadState(deployed)).toEqual({ ok: true });
  const begin = () => {
    const result = simulation.beginCommanderControl(actor.uid);
    if (!result.ok) throw new Error(result.reason);
    return result.generation;
  };
  const input = (generation: number, patch: Partial<CommanderInput> = {}) => simulation.submitCommanderInput({
    generation, forward: 0, right: 0, heading: 0, pitch: 0, buttons: 0, ...patch
  });
  if (!mounted) {
    const generation = begin();
    simulation.update(.05);
    expect(input(generation, { buttons: COMMANDER_INPUT_BUTTON.dismount })).toBe(true);
    simulation.update(.05);
    expect(simulation.endCommanderControl(generation)).toBe(true);
  }
  const body = () => simulation.frames().find(row => row.uid === actor.uid)!;
  const state = () => simulation.militarySoldiers().find(row => row.actor === actor.uid)!.combat!;
  expect(body().mounted === true).toBe(mounted);
  return { actor: actor.uid, begin, body, input, simulation, state };
};
