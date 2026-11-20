import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { createReactSettlementWindow } from "../react-window";
import type { SettlementUiStore } from "../ui-store";

/** Building overview window; a card visits the type's completed buildings in turn and closes the window. */
export const createSettlementBuildingRegisterWindow = (
  store: SettlementUiStore, onFocus: (id: string) => void, i18n?: I18n
) =>
  createReactSettlementWindow({
    className: "settlement-ui__building-register-window",
    contentClassName: "settlement-ui__building-register",
    heading: translateMessage(i18n, M.register.title),
    id: "settlement-building-register-title",
    load: async (visibility, close) =>
      (await import("./mount")).createBuildingRegisterMount(store, visibility, { close, onFocus })
  });
