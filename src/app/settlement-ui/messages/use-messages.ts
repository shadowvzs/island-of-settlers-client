import { useLingui } from "@lingui/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useExternalStore } from "../../components/external-store";
import { type OpenRequestStore, requestedSubject } from "../open-request";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import { useWindowSelector } from "../use-window-selector";
import { getInboxDetails, getMessageTabs, getSelectedReport, selectMessages, shouldMarkRead } from "./helpers";

/**
 * The picked mail; an opening that carries an opener token (script `openUi messages`) shows the requested mail
 * until the player picks another one in that opening.
 */
const useMailSelection = (opened: number, requestedId: string) => {
  const [picked, setPicked] = useState({ id: "", opened: 0 });
  const selectedId = requestedId && picked.opened !== opened ? requestedId : picked.id;
  return { selectedId, onSelect: (id: string) => setPicked({ id, opened }) };
};

/**
 * Mail tabs and the shown mail (the selected one, else the newest). Showing an unread mail in the visible
 * window marks it read once, from an effect, never while rendering.
 */
export const useMessages = (
  store: SettlementUiStore, visibility: SettlementWindowVisibilityStore, request: OpenRequestStore,
  onReadMessage?: (id: string) => void
) => {
  const { i18n } = useLingui();
  const { opened, selection: messages, visible } = useWindowSelector(
    store, visibility, selectMessages, Object.is, i18n.locale);
  const { selectedId, onSelect } = useMailSelection(opened, requestedSubject(useExternalStore(request), opened));
  const report = getSelectedReport(messages, selectedId);
  const marked = useRef(new Set<string>());
  useEffect(() => {
    if (!visible || !shouldMarkRead(report, marked.current)) return;
    marked.current.add(report!.id);
    onReadMessage?.(report!.id);
  }, [onReadMessage, report, visible]);
  return {
    details: useMemo(() => getInboxDetails(report, i18n), [i18n, report]),
    tabs: useMemo(() => getMessageTabs(messages, report?.id, i18n), [i18n, messages, report]),
    onSelect
  };
};
