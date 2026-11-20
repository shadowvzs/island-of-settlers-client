import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { createActor } from "../../shared/settlement/settlement-paths";
import type { SettlementContext } from "../../shared/settlement/settlement-types";

/** Limit the new staffing model to the authorized farm/loom/sea-ship feature chain. */
export const flaxCarrierPool = (save: GameSaveV1, storageUids: readonly number[]) => {
  const state = save.settlement;
  const active = (type: number) => state.buildings.some(building => building.typeId === type &&
    building.construction === 1 && !building.productionPaused && building.worker !== undefined);
  if (!active(60) || !active(61) || !active(36) ||
    !state.naval.modes.some(([, mode]) => mode === "ships")) return undefined;
  return Math.min(state.settlers, state.buildings.filter(building => storageUids.includes(building.uid))
    .reduce((sum, building) => sum + (building.idleSettlers ?? 0), 0));
};

/** Commit the actual hires once, using the same population/actor creation as native dispatch. */
export const commitFlaxCarriers = (save: GameSaveV1, count: number, storageUids: readonly number[]) => {
  const state = save.settlement;
  for (let index = 0; index < count; index++) {
    const home = state.buildings.find(building => storageUids.includes(building.uid) &&
      (building.idleSettlers ?? 0) > 0);
    if (!home || state.settlers < 1) throw new Error("Offline carrier recruitment exceeds its saved idle pool");
    createActor(state as unknown as SettlementContext, "Carrier", home.uid);
  }
};
