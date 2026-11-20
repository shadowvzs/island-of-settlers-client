import { colonySettlementOptions } from "../../src/app/settlement/colony-boot";
import { stageGameSession } from "../../src/app/settlement/game-session";
import { canWorkerEnterBuildingPlot } from "../../src/app/settlement/island-simulation-hooks";
import { createIslandStockContacts } from "../../src/app/settlement/island-stock-contacts";
import { createOfflineIslandRuntime } from "../../src/app/settlement/offline-island-runtime";
import { createPlayerSession } from "../../src/app/settlement/player-session";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { createGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import {
  createSettlementSimulation, type SettlementSimulation
} from "../../src/shared/settlement/settlement-simulation";

/** Shared by the snapshot-* analysis tools: headless-replay's runtime session (the server's view). */
export const STEP = .05;

export interface Clock { elapsed: number }

export const createSnapshotSession = async (save: GameSaveV1, clock: Clock) => {
  const loaded = await stageGameSession(structuredClone(save)), { world } = loaded.map;
  const runtime = createOfflineIslandRuntime(loaded);
  let now = () => save.savedAt;
  const player = createPlayerSession({ initial: save.player, nation: loaded.settlement.playerNation,
    now: () => now(), seed: world.seed });
  let simulation: SettlementSimulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ ...runtime.hooks, ...colonySettlementOptions(loaded, null),
    canWorkerEnterPlot: canWorkerEnterBuildingPlot, clockStart: save.savedAt,
    onBuildingCompleted: player.buildingCompleted,
    onProduced: player.produced, onTutorialEvent: player.tutorialEvent, playerLevel: player.level, roads,
    stockContact: createIslandStockContacts(world, (x, z) => simulation?.isOccupied(x, z) ?? false),
    unlockAllBuildings: true, world });
  if (!simulation.loadState(loaded.settlement).ok) throw new Error("load failed");
  now = simulation.gameNow;
  player.bind(simulation);
  const saveGame = async (): Promise<GameSaveV1> => (<GameSaveV1>{
    ...await createGameSave(world, simulation.saveState(),
    { ...loaded.map.meta, animals: loaded.map.animals, savedAt: now(), terrain: loaded.map.terrain },
    runtime.save()), player: player.progress() });
  const state = () => ({ runtime: { player: player.progress(), world: runtime.save() },
    settlement: simulation.saveState(), world });
  return { clock, loaded, roads, runtime, saveGame, simulation, state, world };
};
export type SnapshotSession = Awaited<ReturnType<typeof createSnapshotSession>>;
