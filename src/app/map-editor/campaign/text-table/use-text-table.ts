import { useLingui } from "@lingui/react";
import { useEffect, useState } from "react";

import { translateMessage } from "../../../../shared/i18n/translate";
import type { CampaignEditor } from "../campaign-editor";
import { CAMPAIGN_EDITOR_MESSAGES as M } from "../messages";
import { useCampaignEditorState } from "../use-campaign-editor";
import { missingTextIds, textCellId, textTableColumns, textTableGroups, visibleTextIds } from "./helpers";

/**
 * The translation table (CUX-I18N-TABLE): rows of every campaign text, the "only missing" filter and undo.
 * The filter keeps the rows that were missing when it was switched on, so a row does not vanish while it is typed.
 */
export const useTextTable = (editor: CampaignEditor) => {
  const { i18n } = useLingui();
  const { draft, jump, maps, textEdits } = useCampaignEditorState(editor);
  const [filterIds, setFilterIds] = useState<ReadonlySet<string> | null>(null);
  const jumpTextId = jump?.textId;

  useEffect(() => {
    if (!jump?.textId) return;
    const cell = document.getElementById(textCellId(jump.textId, jump.language ?? "en"));
    cell?.focus();
    cell?.scrollIntoView({ block: "center" });
  }, [jump]);

  const allGroups = draft ? textTableGroups(draft, maps, i18n) : [];
  const groups = draft ? textTableGroups(draft, maps, i18n, visibleTextIds(filterIds, jumpTextId)) : [];
  const missing = allGroups.reduce((sum, group) => sum + group.missing, 0);
  return {
    canUndo: textEdits.length > 0,
    columns: textTableColumns(),
    emptyNote: groups.length ? "" : translateMessage(i18n, M.textTable.nothingMissing),
    groups,
    hasMissing: missing > 0,
    missingLabel: translateMessage(i18n, M.textTable.missingCount, { count: missing }),
    onlyMissing: filterIds !== null,
    onlyMissingLabel: translateMessage(i18n, M.textTable.onlyMissing),
    textColumnLabel: translateMessage(i18n, M.textTable.textColumn),
    title: translateMessage(i18n, M.sections.translations),
    undoLabel: translateMessage(i18n, M.textTable.undo),
    onOnlyMissingChange: (on: boolean) => setFilterIds(on && draft ? missingTextIds(draft, maps) : null)
  };
};
