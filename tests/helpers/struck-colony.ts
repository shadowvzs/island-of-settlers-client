import { expect } from "vitest";

import { type ColonyDifficulty, colonyIslandOffers } from "../../src/shared/settlement/colony-expedition-rules";
import { chooseColonyWorld } from "../../src/shared/settlement/colony-world-choice";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";

type SimulationOptions = Partial<Parameters<typeof createSettlementSimulation>[0]>;

/**
 * A colony of `difficulty` (island seed 1234) whose fort nearest the player's home has fallen (its guards gone,
 * its walls down): the colony counterattacks start. `landed`: the goods brought ashore. Files using it mock `generate-world` with
 * `cachedGenerateWorldModule`.
 */
export const struckColony = (
  difficulty: ColonyDifficulty, options: SimulationOptions = {}, landed: Record<string, number> = {}
) => {
  const island = colonyIslandOffers(1234).find(entry => entry.difficulty === difficulty)!;
  const world = chooseColonyWorld(island);
  let simulation: ReturnType<typeof createSettlementSimulation> | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, homeBuilding: 39, initialSettlers: 2,
    initialStock: {}, now: () => 5000, roads, world, ...options });
  const troops = Array.from({ length: 4 }, () => ({ hp: 150, rank: 1, type: "heavy" as const }));
  expect(simulation.startColony({ island, landed, troops }).ok).toBe(true);
  const saved = simulation.saveState();
  const home = simulation.headquarters;
  const fort = simulation.buildings().filter(building => (building.militaryFaction ?? 0) > 0)
    .sort((a, b) => Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z))[0]!;
  const guards = new Set(saved.military!.soldiers.filter(soldier => soldier.building === fort.uid)
    .map(soldier => soldier.actor));
  saved.military!.soldiers = saved.military!.soldiers.filter(soldier => !guards.has(soldier.actor));
  saved.actors = saved.actors.filter(actor => !guards.has(actor.uid));
  Object.assign(saved.military!.combat!.doors.find(door => door.building === fort.uid)!.structure!,
    { fallen: 0, hp: 0 });
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  return simulation;
};
