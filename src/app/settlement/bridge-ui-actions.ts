import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import type { BridgeRemovalResult } from "../../shared/settlement/bridge-dismantling";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import { SETTLEMENT_MESSAGES as M } from "../settlement-ui/messages";
import type { SettlementUiOptions } from "../settlement-ui/types";

interface BridgeActionContext {
  i18n?: I18n;
  message: (text: string, warning?: boolean) => void;
  simulation: Pick<SettlementSimulation, "cancelBridgeUpgrade" | "removeBridge" | "requestBridgeUpgrade">;
  updateUi: () => void;
}

const removalMessage = (result: BridgeRemovalResult) => {
  if (!result.ok) return result.reason === "removing" ? M.bridge.removalBusy : M.bridge.removeRefused;
  return result.completed ? M.bridge.closing : M.bridge.removed;
};

/** Bridge panel commands: each runs one journalled simulation command, reports it and refreshes the HUD. */
export const createBridgeCommandActions = (
  { i18n, message, simulation, updateUi }: BridgeActionContext
): Pick<SettlementUiOptions, "onBridgeUpgrade" | "onRemoveBridge"> => ({
  onBridgeUpgrade: (id, cancel) => {
    const result = cancel ? simulation.cancelBridgeUpgrade(id) : simulation.requestBridgeUpgrade(id).ok;
    if (result) message(translateMessage(i18n, cancel ? M.actions.upgradeCancelled : M.actions.upgradeRequested));
    updateUi();
    return result;
  },
  onRemoveBridge: id => {
    const result = simulation.removeBridge(id);
    message(translateMessage(i18n, removalMessage(result)), !result.ok);
    updateUi();
    return result.ok;
  }
});
