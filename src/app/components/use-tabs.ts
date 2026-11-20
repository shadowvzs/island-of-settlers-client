import { type KeyboardEvent, useState } from "react";

import { getNextTabIndex, getTabRows } from "./helpers";

interface TabItem<T> {
  content: T;
  id: string;
  label: string;
}

/** An outside request to show a tab (script `openUi settings` with a section); a new revision applies it. */
export interface TabRequest {
  id: string;
  revision: number;
}

export interface TabsOptions<T> {
  /** Tab buttons get `data-ui-anchor="{anchorPrefix}.{id}"` (map script highlights, TRG9). */
  anchorPrefix?: string;
  /** Id prefix: tabs are `{prefix}-tab-{id}`, panels `{prefix}-panel-{id}`. */
  idPrefix: string;
  /** The tab selected on mount (the first by default). */
  initialIndex?: number;
  items: readonly TabItem<T>[];
  request?: TabRequest | null;
}

type NextTabIndex = (key: string, index: number, count: number) => number | null;

/**
 * The ARIA tab keyboard model: selects the tab a key moves to (arrows wrap, Home / End jump by default)
 * and focuses it; other keys pass through.
 */
export const selectTabByKey = (
  event: KeyboardEvent<HTMLButtonElement>, index: number, tabs: readonly { tabId: string }[],
  select: (index: number) => void, nextIndex: NextTabIndex = getNextTabIndex
) => {
  const next = nextIndex(event.key, index, tabs.length);
  if (next === null) return;
  event.preventDefault();
  select(next);
  document.getElementById(tabs[next]!.tabId)?.focus();
};

/** Active tab with the ARIA keyboard model: arrows wrap, Home / End jump, focus follows the selection. */
export const useTabs = <T>({ anchorPrefix, idPrefix, initialIndex = 0, items, request }: TabsOptions<T>) => {
  const [active, setActive] = useState(initialIndex);
  const [appliedRevision, setAppliedRevision] = useState(0);
  const requestedIndex = request ? items.findIndex(item => item.id === request.id) : -1;
  if (request && request.revision !== appliedRevision) {
    setAppliedRevision(request.revision);
    if (requestedIndex >= 0) setActive(requestedIndex);
  }
  const tabs = getTabRows(idPrefix, items, active, anchorPrefix);
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) =>
    selectTabByKey(event, index, tabs, setActive);
  return { tabs, onTabKeyDown, onTabSelect: setActive };
};
