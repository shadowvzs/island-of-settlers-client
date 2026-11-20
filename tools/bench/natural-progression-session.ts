import { canWorkerEnterBuildingPlot } from "../../src/app/settlement/island-simulation-hooks";
import { createIslandStockContacts } from "../../src/app/settlement/island-stock-contacts";
import { createOfflineIslandRuntime } from "../../src/app/settlement/offline-island-runtime";
import { createPlayerSession } from "../../src/app/settlement/player-session";
import { createGameSave, type GameSaveV1, readGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { isHomeBuilding } from "../../src/shared/settlement/settlement-home";
import { createSettlementSimulation, type SettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementOptions } from "../../src/shared/settlement/settlement-types";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../../src/shared/world/generation/generate-world";

/** Canonical new-island stock, then the same resource/player services as headless restoration. */
export const createNaturalProgressionSession = async (baseline?: GameSaveV1, onProductionCycle?: SettlementOptions["onProductionCycle"]) => {
  if (!baseline) {
    const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, islandCount: 1, seed: 1234 });
    let initial: SettlementSimulation;
    const roads = createRoadNetwork(world, { isBlocked: (x, z) => initial?.isOccupied(x, z) ?? false });
    initial = createSettlementSimulation({ world, roads, developmentAllowed: false, playerNation: "roman" });
    baseline = await createGameSave(world, initial.saveState(), { name: "Earned natural progression",
      source: "generated", savedAt: 1_000_000, animals: [] });
  }
  const loaded = await readGameSave(structuredClone(baseline)), { world } = loaded.map;
  const runtime = createOfflineIslandRuntime(loaded);
  let sim: SettlementSimulation;
  const player = createPlayerSession({ developmentAllowed: false, initial: baseline.player,
    nation: "roman", seed: world.seed, now: () => sim?.gameNow() ?? baseline.savedAt });
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => sim?.isOccupied(x, z) ?? false });
  sim = createSettlementSimulation({ ...runtime.hooks, world, roads, developmentAllowed: false,
    unlockAllBuildings: false, restoredHome: loaded.settlement.buildings.find(isHomeBuilding),
    clockStart: baseline.savedAt, playerNation: "roman", playerLevel: player.level,
    onProductionCycle, onBuildingCompleted: player.buildingCompleted, onProduced: player.produced, onTutorialEvent: player.tutorialEvent,
    canWorkerEnterPlot: canWorkerEnterBuildingPlot,
    stockContact: createIslandStockContacts(world, (x, z) => sim?.isOccupied(x, z) ?? false) });
  const restored = sim.loadState(loaded.settlement);
  if (!restored.ok) throw new Error(restored.reason);
  player.bind(sim);
  const save = async () => ({ ...await createGameSave(world, sim.saveState(), { ...loaded.map.meta,
    animals: loaded.map.animals, savedAt: sim.gameNow(), terrain: loaded.map.terrain }, runtime.save()),
    player: player.progress() });
  return { baseline, player, resourceTargets: runtime.hooks.resourceTargets, save, sim, world };
};
