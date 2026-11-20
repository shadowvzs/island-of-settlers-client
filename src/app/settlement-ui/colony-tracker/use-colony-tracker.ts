import { useLingui } from "@lingui/react";
import { useMemo, useState } from "react";

import { type ExternalStore, useExternalStore } from "../../components/external-store";
import { isShallowEqual } from "../../components/ui-store";
import { useStoreSelector } from "../../components/use-store-selector";
import type { SettlementPopupContent } from "../settlement-popup";
import type { SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";
import { getColonyRows } from "./colony-list-helpers";
import { getExpeditionCard, getPendingExpeditions, getTrackerHeading, selectColonyTracker } from "./helpers";

export interface ColonyTrackerContext {
  collapsed: ExternalStore<boolean>;
  confirm: (popup: SettlementPopupContent) => void;
  /** The drag handle; its icon, heading and the collapse toggle render into it. */
  handle: HTMLElement;
  options: SettlementUiOptions;
  store: SettlementUiStore;
  toggleCollapsed: () => void;
}

/** Expedition cards (one opened at a time), the colony list and the collapsed heading with its count. */
export const useColonyTracker = ({ collapsed, confirm, options, store, toggleCollapsed }: ColonyTrackerContext) => {
  const { i18n } = useLingui();
  const slice = useStoreSelector(store, selectColonyTracker, isShallowEqual, true, i18n.locale);
  const isCollapsed = useExternalStore(collapsed);
  const [expanded, setExpanded] = useState<number | null>(null);
  const pending = useMemo(() => getPendingExpeditions(slice), [slice]);
  const canCancel = Boolean(options.onCancelColony);
  return {
    cards: useMemo(() => pending.map(expedition =>
      getExpeditionCard(expedition, slice.nation, expedition.id === expanded, canCancel, i18n)),
    [canCancel, expanded, i18n, pending, slice.nation]),
    header: getTrackerHeading(isCollapsed,
      pending.length + slice.colonies.length + slice.adventures.length, i18n),
    // Conquered colonies count down in game time (real days); each published snapshot refreshes it.
    // oxlint-disable-next-line react/purity -- deliberate: the clock is read once per snapshot
    rows: useMemo(() => getColonyRows(slice, (options.gameNow ?? Date.now)(), options, confirm, i18n),
      [confirm, i18n, options, slice]),
    onCancel: (id: number) => { options.onCancelColony?.(id); },
    onToggleCard: (id: number) => setExpanded(current => current === id ? null : id),
    onToggleCollapsed: toggleCollapsed
  };
};

export type ColonyTrackerView = ReturnType<typeof useColonyTracker>;
