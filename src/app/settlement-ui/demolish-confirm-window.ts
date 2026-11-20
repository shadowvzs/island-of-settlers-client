import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import { createDemolishConfirmation, getDemolishConfirmationText, isDemolishQuestionStale } from "./demolish-confirmation-helpers";
import { SETTLEMENT_MESSAGES as M } from "./messages";
import { createReactSettlementWindow } from "./react-window";
import type { SettlementBuildingSummary } from "./types";

/**
 * Separate themed window asking before a demolition (owner decision 2026-10-12). Keep, the close
 * button, Escape and a press outside the window cancel; it never blocks the map. The question lives in
 * a React-free store; the React content mounts on the first request.
 */
export const createDemolishConfirmWindow = (onDemolish: (uid: number) => void, i18n?: I18n) => {
  const confirmation = createDemolishConfirmation(i18n);
  let nation: string | undefined;
  const dialog = createReactSettlementWindow({
    className: "settlement-ui__demolish-window",
    contentClassName: "settlement-ui__demolish-confirm",
    data: { "data-demolish-confirm": "" },
    heading: translateMessage(i18n, M.demolish.title),
    id: "settlement-demolish-confirm-title",
    load: async () => (await import("./demolish-confirm/mount")).createDemolishConfirmMount(confirmation, onDemolish),
    onClose: confirmation.cancel
  });
  const unsubscribe = confirmation.subscribe(() => {
    const question = confirmation.getSnapshot();
    if (!question) {
      if (dialog.isOpen()) dialog.close();
      return;
    }
    dialog.setTitle(getDemolishConfirmationText(question.name, question.completed, i18n).title);
    dialog.open();
  });
  return {
    close: () => confirmation.cancel(),
    refreshTitle: () => {
      const question = confirmation.getSnapshot();
      if (question)
        dialog.setTitle(getDemolishConfirmationText(question.name, question.completed, i18n).title);
    },
    root: dialog.root,
    dispose: () => {
      unsubscribe();
      confirmation.cancel();
      dialog.dispose();
    },
    request: (target: SettlementBuildingSummary) => confirmation.request(target, nation),
    /** Closes the question once its building is gone or no longer the focused one. */
    sync: (focusedUid: string | null | undefined, buildings?: readonly SettlementBuildingSummary[],
      playerNation?: string) => {
      nation = playerNation;
      if (isDemolishQuestionStale(confirmation.pending(), focusedUid, buildings)) confirmation.cancel();
    }
  };
};
