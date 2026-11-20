// Generation time and layout of colony and adventure islands (96×96, owner decision 2026-10-12):
// world generation, the deterministic dry run, and what each island holds once settled.
// Run: npx tsx tools/bench/expedition-island-generation.ts [seeds=3]
import { adventureOffers } from "../../src/shared/settlement/adventure-rules";
import { colonyIslandOffers } from "../../src/shared/settlement/colony-expedition-rules";
import { chooseAdventureWorld, chooseColonyWorld } from "../../src/shared/settlement/colony-world-choice";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import {
  createSettlementSimulation, type SettlementSimulation
} from "../../src/shared/settlement/settlement-simulation";
import type { WorldData } from "../../src/shared/world/world-data";

const seeds = Array.from({ length: Number(process.argv[2] ?? 3) }, (_, index) => 1234 + index * 977);

const timed = <T>(action: () => T) => {
  const started = performance.now();
  const value = action();
  return { ms: Math.round(performance.now() - started), value };
};

const settle = (world: WorldData, homeBuilding: 39 | null) => {
  let simulation: SettlementSimulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ homeBuilding, initialSettlers: 0, initialStock: {}, roads, world });
  return simulation;
};

const hostiles = (simulation: SettlementSimulation) =>
  simulation.militarySoldiers().filter(soldier => (soldier.combat?.faction ?? 0) > 0);

for (const seed of seeds) {
  for (const island of adventureOffers(seed)) {
    const { ms, value: world } = timed(() => chooseAdventureWorld(island));
    const simulation = settle(world, null);
    simulation.startAdventure({ island, troops: [] });
    const landing = simulation.adventure()!.landing!;
    const nearest = Math.min(...hostiles(simulation).map(soldier => {
      const actor = simulation.frames().find(entry => entry.uid === soldier.actor)!;
      return Math.hypot(actor.x - landing.shore.x, actor.z - landing.shore.z);
    }));
    console.log(JSON.stringify({ buildings: simulation.buildings().length, chooseMs: ms,
      difficulty: island.difficulty, enemies: hostiles(simulation).length, kind: "adventure",
      nearestEnemy: Math.round(nearest), seed,
      size: `${world.cellsX}x${world.cellsZ}` }));
  }
  for (const island of colonyIslandOffers(seed).slice(0, 3)) {
    const { ms, value: world } = timed(() => chooseColonyWorld(island));
    const simulation = settle(world, 39);
    simulation.startColony({ island, landed: {}, troops: [] });
    const forts = simulation.buildings().filter(building => (building.militaryFaction ?? 0) > 0);
    console.log(JSON.stringify({ chooseMs: ms, difficulty: island.difficulty, forts: forts.length,
      garrisoned: hostiles(simulation).filter(soldier => soldier.stationed).length, home: simulation.home()?.typeId,
      kind: "colony", oreCells: world.mineZones.filter(zone => zone.ore).map(zone => zone.cellCount), seed,
      size: `${world.cellsX}x${world.cellsZ}` }));
  }
}
