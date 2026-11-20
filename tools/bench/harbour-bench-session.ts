import { readFile } from "node:fs/promises";

import { stageGameSession } from "../../src/app/settlement/game-session";
import { createIslandStockContacts } from "../../src/app/settlement/island-stock-contacts";
import { createOfflineIslandRuntime } from "../../src/app/settlement/offline-island-runtime";
import { isBuildingCourtyardPointWalkable } from "../../src/render-common/buildings/building-courtyard";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { savedHomeBuilding } from "../analysis/helpers";

/**
 * Shared harbour bench session: loads a save as the live island does (normal load, loading-screen
 * prewarm, one second of ticks) for `harbour-panel-query-timing.ts` and `jetty-frame-timing.ts`.
 */
export const loadHarbourBenchSession = async (sourcePath: string) => {
  const source = JSON.parse((await readFile(sourcePath)).toString("utf8")) as GameSaveV1;
  const startedAt = Date.now();
  const loaded = await stageGameSession({ ...source, savedAt: startedAt }), { world } = loaded.map;
  const runtime = createOfflineIslandRuntime(loaded);
  let simulation: ReturnType<typeof createSettlementSimulation> | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, ...runtime.hooks,
    homeBuilding: savedHomeBuilding(loaded.settlement.buildings.find(building =>
      building.typeId === 0 || building.colonyHome)),
    playerNation: loaded.settlement.playerNation, now: () => startedAt,
    roadDecorationCustody: { consume: () => true, receive: () => true },
    stockContact: createIslandStockContacts(world),
    canWorkerEnterPlot: (building, point) => building.construction < 1 ||
      isBuildingCourtyardPointWalkable(building.typeId, building.x, building.z, building.rotation,
        point, building.output, building.input) });
  const restored = simulation.loadState(loaded.settlement);
  if (!restored.ok) throw new Error(restored.reason);
  const prewarmStart = performance.now();
  const work = simulation.prewarmCoastalGeometry();
  while (!work.next().done) { /* loading-screen prewarm */ }
  const prewarmMs = performance.now() - prewarmStart;
  for (let step = 0; step < 20; step++) simulation.update(.05);
  return { prewarmMs, roads, simulation, world };
};

/** Synchronous wall time of one call, rounded to 0.01 ms. */
export const timed = <T>(run: () => T) => {
  const start = performance.now();
  const value = run();
  return { ms: +(performance.now() - start).toFixed(2), value };
};
