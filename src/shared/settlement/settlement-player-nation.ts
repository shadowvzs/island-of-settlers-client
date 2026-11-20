import { isWorkerNation } from "../../render-common/workers/worker-appearance";
import { migrateSettlementNation } from "./settlement-nation-migration";
import { type SettlementSaveV1, validateSettlementSave } from "./settlement-save-state";
import type { SettlementContext } from "./settlement-types";

/** Validation and mutation use the same migration; the query never touches live simulation. */
export const createSettlementNationCommands = (context: SettlementContext, saveState: () => SettlementSaveV1,
  loadState: (value: unknown) => { ok: boolean }) => {
  const setNation = (nation: unknown) => {
    if (!isWorkerNation(nation)) return false;
    if (nation === (context.playerNation ?? "roman")) return true;
    return loadState(migrateSettlementNation(saveState(), nation)).ok;
  };
  return {
  canSetPlayerNation: (nation: unknown) => isWorkerNation(nation) &&
    validateSettlementSave(migrateSettlementNation(saveState(), nation), context) === null,
  setPlayerNation: setNation,
  debugSetPlayerNation: setNation
  };
};
