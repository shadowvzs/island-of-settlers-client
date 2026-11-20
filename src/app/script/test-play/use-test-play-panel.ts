import { useLingui } from "@lingui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MapScript } from "../../../../../island-of-settlers-shared/src/script/types/script";
import { translateMessage } from "../../../shared/i18n/translate";
import { useExternalStore } from "../../components/external-store";
import {
  TEST_PLAY_CLEAR_ICON, TEST_PLAY_COLLAPSE_ICONS, TEST_PLAY_KIND_ICONS, TEST_PLAY_LOG_KINDS, type TestPlayLogKind
} from "./constants";
import { testPlayLogRows, testPlayNames, toggledKinds } from "./helpers";
import { TEST_PLAY_MESSAGES as M } from "./messages";
import type { TestPlayLog } from "./test-play-log";

/** Keeps the list at its newest line while the reader has not scrolled up. */
export const useFollowNewest = (rowCount: number) => {
  const list = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  // A new row count is the signal to scroll; the effect reads only the element.
  // oxlint-disable-next-line react/exhaustive-deps
  useEffect(() => {
    const element = list.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
  }, [rowCount]);
  const onScroll = useCallback(() => {
    const element = list.current;
    if (element) following.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 2;
  }, []);
  return { list, onScroll };
};

/**
 * The play-test log prepared for the view. It renders when the log publishes (0.25 s cadence, only with new
 * lines), a filter or the header is toggled, or the locale changes; never per frame.
 */
export const useTestPlayPanel = (log: TestPlayLog, script: MapScript | undefined) => {
  const { i18n } = useLingui();
  const { locale } = i18n;
  const records = useExternalStore(log.store);
  const [hidden, setHidden] = useState<ReadonlySet<TestPlayLogKind>>(() => new Set());
  const [collapsed, setCollapsed] = useState(false);
  const names = useMemo(() => testPlayNames(script), [script]);
  // The locale is a dependency: `i18n` keeps its identity when the language changes.
  // oxlint-disable-next-line react/exhaustive-deps
  const rows = useMemo(() => testPlayLogRows(records, hidden, names, i18n), [hidden, i18n, locale, names, records]);
  const filters = TEST_PLAY_LOG_KINDS.map(kind => ({
    icon: TEST_PLAY_KIND_ICONS[kind], kind, label: translateMessage(i18n, M.filter[kind]), pressed: !hidden.has(kind)
  }));
  const emptyMessage = script ? M.empty : M.noScript;
  return {
    clearIcon: TEST_PLAY_CLEAR_ICON,
    clearLabel: translateMessage(i18n, M.clear),
    collapseIcon: TEST_PLAY_COLLAPSE_ICONS[collapsed ? "collapsed" : "expanded"],
    collapseLabel: translateMessage(i18n, collapsed ? M.expand : M.collapse),
    emptyText: translateMessage(i18n, emptyMessage),
    expanded: !collapsed,
    filters,
    isEmpty: rows.length === 0,
    rows,
    title: translateMessage(i18n, M.title),
    onClear: log.clear,
    onToggleCollapsed: useCallback(() => setCollapsed(value => !value), []),
    onToggleKind: useCallback((kind: TestPlayLogKind) => setHidden(current => toggledKinds(current, kind)), [])
  };
};
