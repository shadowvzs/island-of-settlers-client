import { useLingui } from "@lingui/react";
import { type KeyboardEvent, useMemo, useState } from "react";

import { useExternalStore } from "../../components/external-store";
import { getCommandStatus, getNextRovingIndex, settleCommand } from "../../components/helpers";
import { useCommandStatus } from "../../components/use-command-status";
import { selectTabByKey } from "../../components/use-tabs";
import { type OpenRequestStore, requestedSubject } from "../open-request";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";
import { useWindowSelector } from "../use-window-selector";
import {
  completeQuest, getQuestConfirming, getQuestDetails, getQuestTabs, getTutorialSkipped,
  isSameQuestBook, type QuestSelection, resolveQuestSelection, selectQuestBook, skipTutorialQuest
} from "./helpers";

export type QuestBookOptions = Pick<
  SettlementUiOptions, "onCompleteQuest" | "onShowTutorial" | "onSkipTutorial"
>;

interface SelectionState extends QuestSelection {
  /** The window opening this selection belongs to: each open starts on the first quest. */
  opened: number;
  /** Counts the player's picks; a pick clears the status line, a replaced quest does not. */
  revision: number;
}

/**
 * The selected quest: reset on every open (to the opener token's quest when that opening carries one), kept while
 * it is listed, replaced (and remembered as replaced) once it left the list, as the DOM book did.
 */
const useQuestSelection = (
  opened: number, requestedId: string, resolve: (selection: QuestSelection) => Required<QuestSelection>
) => {
  const [state, setState] = useState<SelectionState>({ id: requestedId, opened, revision: 0 });
  const current = state.opened === opened ? state : { id: requestedId, opened, revision: 0 };
  const resolved = resolve(current);
  const next = { ...current, ...resolved };
  if (next.id !== state.id || next.category !== state.category || next.opened !== state.opened) setState(next);
  return {
    selection: next,
    select: (id: string) => setState({ ...next, id, revision: next.revision + 1 })
  };
};

/** Quest tabs, the selected quest's details and the claim / skip status of the quest book. */
export const useQuestBook = (
  store: SettlementUiStore, visibility: SettlementWindowVisibilityStore, request: OpenRequestStore,
  options: QuestBookOptions
) => {
  const { i18n } = useLingui();
  const selectBook = useMemo(() => (snapshot: Parameters<typeof selectQuestBook>[0]) =>
    selectQuestBook(snapshot, i18n), [i18n]);
  const { opened, selection: book } = useWindowSelector(
    store, visibility, selectBook, isSameQuestBook, i18n.locale);
  const requestedId = requestedSubject(useExternalStore(request), opened);
  const { select, selection } = useQuestSelection(opened, requestedId,
    current => resolveQuestSelection(book, current));
  const confirming = getQuestConfirming(i18n);
  const { report, status } = useCommandStatus("", `${opened}:${selection.revision}:${i18n.locale}`);
  const tabs = useMemo(() => getQuestTabs(book, selection.id, i18n), [book, i18n, selection.id]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  return {
    details: useMemo(() => getQuestDetails(book, selection.id, confirmingId, i18n),
      [book, confirmingId, i18n, selection.id]),
    loaded: book.loaded,
    renewCountdown: book.renewCountdown,
    renewText: book.renewText,
    status,
    tabs,
    onClaim: (id: string) => settleCommand(completeQuest(options, id), outcome => {
      setConfirmingId(null);
      report(getCommandStatus(outcome, ""));
    }, () => {
      setConfirmingId(id);
      report(confirming);
    }),
    onShow: (id: string) => options.onShowTutorial?.(id),
    onSkip: (id: string) => report(getCommandStatus(skipTutorialQuest(options, id), getTutorialSkipped(i18n))),
    onTabKeyDown: (event: KeyboardEvent<HTMLButtonElement>, index: number) =>
      selectTabByKey(event, index, tabs.all, next => select(tabs.all[next]!.id), getNextRovingIndex),
    onTabSelect: select
  };
};

export type QuestBookView = ReturnType<typeof useQuestBook>;
