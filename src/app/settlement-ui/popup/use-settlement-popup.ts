import { useLingui } from "@lingui/react";
import { useMemo } from "react";

import { useExternalStore } from "../../components/external-store";
import type { SettlementPopupStore } from "../settlement-popup";
import { getPopupView } from "./helpers";

/** The popup on screen: its prepared view, and an action handler that closes first, then acts. */
export const useSettlementPopup = (store: SettlementPopupStore, close: () => void) => {
  const { i18n } = useLingui();
  const { content, revision } = useExternalStore(store);
  return {
    revision,
    view: useMemo(() => content && getPopupView(content, i18n), [content, i18n]),
    onAction: (index: number) => {
      const action = content?.actions[index];
      close();
      action?.onSelect?.();
    }
  };
};
