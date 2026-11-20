import { useLingui } from "@lingui/react";
import { type DragEvent, useState } from "react";

import { translateMessage } from "../../../../shared/i18n/translate";
import type { CampaignEditor } from "../campaign-editor";
import { MAP_ROW_DRAG_TYPE } from "../constants";
import { displayText } from "../helpers";
import { CAMPAIGN_EDITOR_MESSAGES as M } from "../messages";
import { useCampaignEditorState } from "../use-campaign-editor";
import { mapListRows, unlistedMaps } from "./helpers";

/** Ordered map list rows with drag-and-drop and button reordering, plus the campaign's unlisted maps. */
export const useMapsSection = (editor: CampaignEditor) => {
  const { i18n } = useLingui();
  const state = useCampaignEditorState(editor);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const draft = state.draft!, language = i18n.locale;
  const rows = mapListRows(draft, state.maps, state.selectedMapId, language).map(row => ({
    ...row,
    downLabel: translateMessage(i18n, M.actions.moveDown, { name: row.name }),
    dragging: row.index === dragIndex,
    removeLabel: translateMessage(i18n, M.actions.unlist, { name: row.name }),
    upLabel: translateMessage(i18n, M.actions.moveUp, { name: row.name })
  }));
  const unlisted = unlistedMaps(draft, state.maps).map(map => ({ id: map.id, name: displayText(map.name, language,
    map.id) }));
  return {
    addLabel: translateMessage(i18n, M.actions.addMap),
    busy: state.busy,
    deleteLabel: translateMessage(i18n, M.actions.deleteMap),
    emptyNote: translateMessage(i18n, M.notes.noMaps),
    listLabel: translateMessage(i18n, M.actions.list),
    orderTitle: translateMessage(i18n, M.sections.order),
    readyLabel: translateMessage(i18n, M.badges.ready),
    rows,
    unlisted,
    unlistedTitle: translateMessage(i18n, M.notes.unlisted),
    onDragEnd: () => setDragIndex(null),
    onDragOver: (event: DragEvent) => {
      if (event.dataTransfer.types.includes(MAP_ROW_DRAG_TYPE)) event.preventDefault();
    },
    onDragStart: (event: DragEvent, index: number) => {
      event.dataTransfer.setData(MAP_ROW_DRAG_TYPE, String(index));
      event.dataTransfer.effectAllowed = "move";
      setDragIndex(index);
    },
    onDrop: (event: DragEvent, index: number) => {
      event.preventDefault();
      const from = Number(event.dataTransfer.getData(MAP_ROW_DRAG_TYPE));
      setDragIndex(null);
      if (Number.isInteger(from)) editor.moveMap(from, index);
    }
  };
};
