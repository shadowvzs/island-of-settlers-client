import { translateMessage } from "../../../shared/i18n/translate";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { createOpenRequest } from "../open-request";
import { createReactSettlementWindow } from "../react-window";
import type { SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";

import "./message-window.css";

/**
 * Inbox opened from the player HUD: battle reports and scripted mails; reading one marks it read. `openWith` is
 * the script opener (TRG9): that opening shows the given mail when it is listed.
 */
export const createMessageWindow = (store: SettlementUiStore, options: SettlementUiOptions) => {
  const request = createOpenRequest();
  const frame = createReactSettlementWindow({
    className: "settlement-ui__message-window",
    contentClassName: "message-window",
    heading: translateMessage(options.i18n, M.messages.title),
    id: "settlement-messages-title",
    load: async visibility => (await import("./mount")).createMessagesMount(store, visibility, request,
      options.onReadMessage)
  });
  return {
    ...frame,
    openWith: ({ mailId }: { mailId: string | null }) => {
      request.set(mailId === null ? null : { opened: frame.nextOpening(), subjectId: mailId });
      frame.open();
    }
  };
};
