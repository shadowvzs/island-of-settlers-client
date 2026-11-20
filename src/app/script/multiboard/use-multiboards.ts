import type { I18n } from "@lingui/core";
import { useLingui } from "@lingui/react";
import { useCallback, useMemo, useState } from "react";

import { displayQuestText } from "../../../shared/i18n/quest-text";
import { useExternalStore } from "../../components/external-store";
import { contentIconUrl } from "./content-icon";
import {
  type BoardTextContext, type BoardView, collapseKey, createBoardViewCache, getBoardViews, withLocalCollapse
} from "./helpers";
import { MULTIBOARD_MESSAGES as M } from "./messages";
import { localCollapse, multiboardFeed, rememberLocalCollapse } from "./multiboard-store";
import { usePhoneLayout } from "./use-phone-layout";

/** Board texts and labels in the active locale (also the map editor's board preview). */
export const multiboardTextContext = (i18n: I18n): BoardTextContext => ({
  collapseLabel: title => i18n._({ ...M.collapse, values: { title } }),
  expandLabel: title => i18n._({ ...M.expand, values: { title } }),
  iconUrl: contentIconUrl,
  locale: i18n.locale,
  text: text => displayQuestText(text, i18n)
});

/**
 * The visible boards prepared for the view. It renders only when the engine publishes a changed board list, the
 * player toggles a header, the locale changes or the viewport crosses the phone width; never per frame.
 */
export const useMultiboards = () => {
  const { i18n } = useLingui();
  const { locale } = i18n;
  const feed = useExternalStore(multiboardFeed);
  const toggles = useExternalStore(localCollapse);
  const phone = usePhoneLayout();
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // The locale is the cache key: another language resolves every text again.
  // oxlint-disable-next-line react/exhaustive-deps
  const viewOf = useMemo(() => createBoardViewCache(multiboardTextContext(i18n)), [i18n, locale]);
  const boards = useMemo(
    () => getBoardViews(feed.boards, { focusedId, phone, scope: feed.scope, toggles }, viewOf),
    [feed, focusedId, phone, toggles, viewOf]
  );
  const onToggle = useCallback((board: BoardView) => {
    const key = collapseKey(multiboardFeed.getSnapshot().scope, board.id);
    rememberLocalCollapse(withLocalCollapse(localCollapse.getSnapshot(), key,
      { collapsed: board.expanded, revision: board.revision }));
    if (board.collapsed) setFocusedId(board.id);
  }, []);
  return { boards, label: i18n._(M.stack), onToggle };
};
