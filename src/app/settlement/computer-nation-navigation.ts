import { loadBuildingNavigation } from "@shared/catalog/building-data/navigation";

import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { enemyNationFor } from "../../shared/settlement/enemy-nation";
import { scriptableFactionAi } from "../../shared/world/scenario-faction-ai-script";
import type { WorldData } from "../../shared/world/world-data";

/**
 * EAI2b: a map whose computer factions have, or may get by script, an economy builds in the island's computer
 * nation (`settlement-nation.ts`), so its building navigation sidecars load before the first tick, like the
 * player nation's (CAT8). A map without such a faction loads nothing more.
 */
export const loadComputerNationNavigation = async (world: Pick<WorldData, "scenario" | "seed">,
  playerNation: WorkerNation) => {
  if (!scriptableFactionAi(world.scenario).length) return;
  await loadBuildingNavigation(enemyNationFor(playerNation, world.seed));
};
