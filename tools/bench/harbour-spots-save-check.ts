import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { stageGameSession } from "../../src/app/settlement/game-session";
import { createIslandStockContacts } from "../../src/app/settlement/island-stock-contacts";
import { createOfflineIslandRuntime } from "../../src/app/settlement/offline-island-runtime";
import { placeHarbourSpots } from "../../src/shared/settlement/generated-harbour-spots";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { storedHarbourSpots } from "../../src/shared/settlement/harbour-spot-index";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { harbourPlacementReason } from "../../src/shared/settlement/settlement-harbour-placement";
import { createScenarioInspectionContext } from "../../src/shared/settlement/settlement-map-scenario";
import { makeBuilding } from "../../src/shared/settlement/settlement-placement";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { savedHomeBuilding } from "../analysis/helpers";

/**
 * HARBOUR-SPOTS on a real owner save (read-only): the full harbour-site check (coastal prewarm, the
 * charting re-check) with the save as it is (no stored spots: fallback scan) and with spots added
 * to the loaded world in memory; plus the owner's own harbour plots re-checked as fresh plots.
 * Usage: npx tsx tools/bench/harbour-spots-save-check.ts [save.json]   (default: 2026-11-08 (3))
 */
const sourcePath = resolve(process.argv[2] ?? "/home/shadowvzs/Downloads/island-settlers-2026-11-08 (3).json");
const source = JSON.parse((await readFile(sourcePath)).toString("utf8")) as GameSaveV1;

const run = async (withSpots: boolean) => {
  const startedAt = Date.now();
  const loaded = await stageGameSession({ ...source, savedAt: startedAt }), { world } = loaded.map;
  const islands = world.playableIslands?.sites.length ?? 0;
  const spotsPerIsland = withSpots ? placeHarbourSpots(world) : [];
  const runtime = createOfflineIslandRuntime(loaded);
  let simulation: ReturnType<typeof createSettlementSimulation> | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, ...runtime.hooks,
    homeBuilding: savedHomeBuilding(loaded.settlement.buildings.find(building =>
      building.typeId === 0 || building.colonyHome)),
    now: () => startedAt, playerNation: loaded.settlement.playerNation,
    stockContact: createIslandStockContacts(world) });
  const restored = simulation.loadState(loaded.settlement);
  if (!restored.ok) throw new Error(restored.reason);
  const started = performance.now();
  const work = simulation.prewarmCoastalGeometry();
  let total = 0;
  for (let step = work.next(); !step.done; step = work.next()) total = step.value.total;
  const recheckMs = performance.now() - started;
  // The owner's harbours as fresh plots on an empty scratch context: still valid via the fallback scan.
  const scratch = createScenarioInspectionContext(world);
  const harbours = loaded.settlement.buildings.filter(building => building.typeId === 39);
  const ownerPlots = harbours.map(harbour => ({ uid: harbour.uid,
    valid: harbourPlacementReason(scratch, makeBuilding(scratch, 39, harbour.x, harbour.z, harbour.rotation)) === null }));
  return { islands, ownerPlots, proofQueries: total, recheckMs: Math.round(recheckMs),
    spots: storedHarbourSpots(world).length, spotsPerIsland, withSpots };
};

for (const withSpots of [false, true]) console.log(JSON.stringify(await run(withSpots)));
