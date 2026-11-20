import { advanceSavedMilitaryRecovery } from "../../shared/settlement/settlement-military-recovery";
import { migrateSavedMilitaryHealth } from "../../shared/settlement/settlement-military-state";
import type { SettlementSaveV1 } from "../../shared/settlement/settlement-save-state";

/**
 * Fast catch-up starts after the native calibration prefix. Migrate the one-time archer HP change
 * first, then credit whole eligible resting minutes for the modeled remainder.
 */
export const recoverOfflineMilitary = (settlement: SettlementSaveV1, seconds: number) => {
  if (!settlement.military) return 0;
  migrateSavedMilitaryHealth(settlement.military);
  return advanceSavedMilitaryRecovery(settlement, seconds);
};
