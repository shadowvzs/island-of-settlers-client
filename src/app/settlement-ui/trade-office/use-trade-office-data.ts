import { useLingui } from "@lingui/react";
import { useRef, useSyncExternalStore } from "react";

import type { SettlementUiStore } from "../ui-store";
import type { TradeOfficePanel } from "./helpers";
import { isSameTradeOffice, selectTradeOffice, type TradeOfficeData } from "./select-trade-office";
import type { SettlementTradeOffice } from "./types";

interface DataCache {
  data: TradeOfficeData;
  key: readonly unknown[];
}

const isSameKey = (left: readonly unknown[], right: readonly unknown[]) =>
  left.every((value, index) => Object.is(value, right[index]));

/**
 * The trade office data for the shown panel. Recomputed when the settlement UI publishes (tick, command),
 * the panel changes or a command of this window ran (`revision`); kept while hidden; an equal result keeps
 * the previous object, so React renders nothing.
 */
export const useTradeOfficeData = (
  store: SettlementUiStore, trade: SettlementTradeOffice, panel: TradeOfficePanel, revision: number,
  visible: boolean
) => {
  const { i18n } = useLingui();
  const cache = useRef<DataCache | null>(null);
  const read = () => {
    const key = [store.getSnapshot(), panel, revision, i18n.locale];
    const current = cache.current;
    if (current && (!visible || isSameKey(current.key, key))) return current.data;
    const data = selectTradeOffice(store.getSnapshot(), trade, panel, i18n);
    const kept = current && isSameTradeOffice(current.data, data) ? current.data : data;
    cache.current = { data: kept, key };
    return kept;
  };
  return useSyncExternalStore(store.subscribe, read, read);
};
