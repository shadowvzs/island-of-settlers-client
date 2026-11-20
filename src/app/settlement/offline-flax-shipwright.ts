import type { GameSaveV1 } from "../../shared/settlement/game-save";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";
import { advanceOfflineGame, type OfflineReplayOptions } from "./offline-progress";

const islands = (save: GameSaveV1) => {
  const active = save.archipelago?.active ?? null;
  const result = [{ id: String(active ?? "home"), save }];
  if (active !== null && save.archipelago?.home) result.push({ id: "home", save: save.archipelago.home });
  for (const record of [...save.archipelago?.colonies ?? [], ...save.archipelago?.adventures ?? []])
    if (record.save && record.expeditionId !== active)
      result.push({ id: String(record.expeditionId), save: record.save });
  return result;
};

/**
 * A saved shipwright may still physically own a paid plank or cloth roll after calibration.
 * Finish that original visit in native simulation before handing its yard to the event model.
 * Pausing NEW shipwright work bounds the handoff without duplicating a second in-flight receipt.
 * All islands advance together through the existing exact chronology; no future time is borrowed.
 */
export const settleOriginalShipwrights = async (
  source: GameSaveV1, seconds: number, options: OfflineReplayOptions,
  report: Parameters<typeof advanceOfflineGame>[2]
): Promise<{ save: GameSaveV1; seconds: number }> => {
  if (seconds < .05) return { save: source, seconds: 0 };
  const receipts = islands(source).flatMap(({ id, save }) => {
    const active = new Set(save.settlement.naval.active.map(([, site]) => site.yard));
    return save.settlement.buildings.filter(building => active.has(building.uid) && building.typeId === 36)
      .map(building => ({ id, uid: building.uid, paused: building.productionPaused }));
  });
  if (!receipts.length) return { save: source, seconds: 0 };
  const detached = structuredClone(source);
  const byId = new Map(islands(detached).map(entry => [entry.id, entry.save]));
  for (const receipt of receipts) {
    const building = byId.get(receipt.id)!.settlement.buildings.find(building => building.uid === receipt.uid)!;
    building.productionPaused = true;
  }
  const duration = Math.min(120, seconds);
  const save = await advanceOfflineGame(detached, detached.savedAt + duration * 1000, report,
    { ...options, economy: false, exact: true, eventCore: false });
  const advanced = new Map(islands(save).map(entry => [entry.id, entry.save]));
  for (const receipt of receipts) {
    const building: SettlementBuilding | undefined = advanced.get(receipt.id)?.settlement.buildings
      .find(building => building.uid === receipt.uid);
    if (!building) continue;
    if (receipt.paused === undefined) delete building.productionPaused;
    else building.productionPaused = receipt.paused;
    if (!receipt.paused && building.status === "Production stopped") building.status = "Resting";
  }
  return { save, seconds: duration };
};
