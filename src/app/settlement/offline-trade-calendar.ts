import { levelForExperience } from "@shared/catalog/balance";

import { talentModifiers } from "../../shared/progression/talents";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { STORAGE_IDS } from "../../shared/settlement/production-rules";
import type { SettlementContext } from "../../shared/settlement/settlement-types";
import { registerStorageAccess } from "../../shared/settlement/shared-storage";
import { updateTrade } from "../../shared/trade/trade-commands";
import { settlementTradePort } from "../../shared/trade/trade-island";
import type { WorldData } from "../../shared/world/world-data";

/**
 * Calendar deadlines continue beyond the production cap. Reuse the canonical trade commands and
 * donor-pool refund port without ticking actors or dispatching speculative merchant ships. Newly
 * filled offers keep their paid escrow and delivery request for normal shipping after recovery. A trade office
 * switched off by the game rules stays still (the shared port refuses through `rulesOf`).
 */
export const advanceOfflineTradeCalendar = (save: GameSaveV1, world: WorldData, now: number) => {
  const state = save.settlement, trade = state.trade;
  if (!trade || state.colony || state.adventure) return;
  const seconds = Math.max(0, (now - save.savedAt) / 1_000);
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  // Canonical storage accessors are temporary views. Never leave a Proxy in a worker's save result.
  const buildings = state.buildings.map(building => ({ ...building, inventory: { ...building.inventory },
    accepts: { ...building.accepts }, exports: building.exports && { ...building.exports } }));
  // The island's pinned rules: a switched-off trade office keeps its calendar still (GS4a, `updateTrade`).
  const context = { actors: state.actors, buildings, gameRules: state.gameRules, playerNation: state.playerNation,
    storagePools: state.storagePools, talents: talentModifiers(save.player?.talents),
    options: { world, now: () => now, playerLevel: () => levelForExperience(save.player?.experience ?? 0) }
  } as SettlementContext;
  for (const building of buildings) if (STORAGE_IDS.has(building.typeId)) registerStorageAccess(context, building);
  updateTrade(trade, settlementTradePort(context, trade), seconds);
  for (let index = 0; index < buildings.length; index++)
    state.buildings[index]!.inventory = JSON.parse(JSON.stringify(buildings[index]!.inventory));
};
