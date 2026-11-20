import assert from "node:assert/strict";

import { createIslandNav } from "../../src/render-common/wildlife/nav/island-nav";
import { createWorkerNav } from "../../src/render-common/workers/worker-nav";
import { findStandSpot, WORKER_NAV_SPECIES } from "../../src/render-common/workers/worker-unit";
import { createGameSave, type GameSaveV1, readGameSave } from "../../src/shared/settlement/game-save";

/**
 * The CPU hunting fixture replaces terrain with dry flat land but inherits cached generated water.
 * Native worker navigation correctly reads that water. Normalize only explicitly dry authored maps,
 * never a real supplied/generated island or a coastal/naval fixture.
 */
export const nativeDryFixture = async (source: GameSaveV1): Promise<GameSaveV1> => {
  const loaded = await readGameSave(source), { world } = loaded.map;
  assert(world.heights.every(height => height > world.seaLevel), "Dry fixture must contain no underwater vertices");
  world.waterDepth.fill(0); world.waterSurface.fill(world.seaLevel); world.lakeWater?.fill(0);
  world.flow.fill(0); world.waterfalls = []; world.authoredRivers = []; world.generatedRivers = [];
  const nav = createWorkerNav(world, createIslandNav(world, []), WORKER_NAV_SPECIES).nav;
  assert(findStandSpot(nav, world.start.x, world.start.z), "Actual native navigation permits a starting worker");
  return { ...source, ...await createGameSave(world, loaded.settlement, { ...loaded.map.meta,
    animals: loaded.map.animals, terrain: loaded.map.terrain, savedAt: source.savedAt }, source.runtime),
    player: source.player, archipelago: source.archipelago };
};
