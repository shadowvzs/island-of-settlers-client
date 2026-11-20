import { COLONY_DIFFICULTIES } from "../balance/colonies";
import type { ColonyDifficulty } from "./colony-expedition-rules";

/**
 * Development menu test expeditions. The flag lives on the island itself, so it travels with the
 * expedition, the archipelago record and the island's own save; normal islands never carry it.
 */
export interface DebugTimedIsland { debug?: true }

/** Test expeditions may carry this many troops on any island (normal caps: 20, 35, 50). */
export const DEBUG_EXPEDITION_TROOP_CAP = COLONY_DIFFICULTIES.easy.troopCap;

/** Mark auto-preparation without changing the island's voyage, balance or lifetime. */
export const debugExpeditionIsland = <T extends DebugTimedIsland & { voyageSeconds: number }>(island: T): T =>
  ({ ...island, debug: true });

export const expeditionTroopCap = (island: DebugTimedIsland & { difficulty: ColonyDifficulty }) =>
  COLONY_DIFFICULTIES[island.difficulty].troopCap;

/** Saved islands may only carry `debug: true`. */
export const debugFlagError = (island: DebugTimedIsland) => island.debug !== undefined && island.debug !== true;
