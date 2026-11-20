import {
  type AwaySummary, OFFLINE_CATCH_UP_CAP_SECONDS
} from "../../../../island-of-settlers-shared/src/offline-catch-up";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { STORAGE_IDS } from "../../shared/settlement/production-rules";
import { isOwnBuilding } from "../../shared/settlement/settlement-home";
import { isSharedStorageWare } from "../../shared/settlement/shared-storage";

export type { AwaySummary };

/** The home island's save: the one on screen, or the archived one while a colony or adventure is. */
const homeSave = (game: GameSaveV1) => (game.archipelago?.active ?? null) === null ? game : game.archipelago?.home;

const storedGoods = (game: GameSaveV1 | undefined) => {
  const goods: Record<string, number> = {};
  const buildings = game?.settlement.buildings ?? [];
  const home = buildings.find(building => building.construction === 1 &&
    (building.typeId === 0 || building.colonyHome) && isOwnBuilding(building));
  if (!home) return goods;
  const pool = game?.settlement.storagePools.pools.find(entry => entry.id === home?.storagePoolId);
  for (const [ware, count] of Object.entries(pool?.available ?? {})) goods[ware] = count;
  for (const building of buildings) {
    if (!STORAGE_IDS.has(building.typeId) || building.storagePoolId !== home?.storagePoolId ||
      !isOwnBuilding(building)) continue;
    for (const [ware, count] of Object.entries(building.inventory)) if (!isSharedStorageWare(ware))
      goods[ware] = (goods[ware] ?? 0) + count;
  }
  return goods;
};

/** Wares whose stock changed, gains first (largest first), then losses. */
const goodsChange = (before: Record<string, number>, after: Record<string, number>) => {
  const change: Record<string, number> = {};
  for (const ware of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const delta = (after[ware] ?? 0) - (before[ware] ?? 0);
    if (delta) change[ware] = delta;
  }
  return Object.fromEntries(Object.entries(change).sort((a, b) => b[1] - a[1]));
};

const colonyNames = (game: GameSaveV1) =>
  new Map((game.archipelago?.colonies ?? []).map(colony => [colony.expeditionId, colony.island.name]));

/** Pure save diff for the offline summary; the presentation strings live in `away-summary.ts`. */
export const summarizeTimeAway = (before: GameSaveV1, after: GameSaveV1, now: number): AwaySummary => {
  const awaySeconds = Math.max(0, (now - before.savedAt) / 1000);
  const remaining = colonyNames(after);
  return {
    awaySeconds,
    capped: awaySeconds > OFFLINE_CATCH_UP_CAP_SECONDS,
    endedColonies: [...colonyNames(before)].filter(([id]) => !remaining.has(id)).map(([, name]) => name),
    experience: (after.player?.experience ?? 0) - (before.player?.experience ?? 0),
    goods: goodsChange(storedGoods(homeSave(before)), storedGoods(homeSave(after)))
  };
};
