import { useLingui } from "@lingui/react";
import { useSyncExternalStore } from "react";

import { translateMessage } from "../../../shared/i18n/translate";
import { resolveEditorText } from "../messages";
import type { CampaignEditor } from "./campaign-editor";
import type { CampaignEditorState } from "./campaign-editor-state";
import { CAMPAIGN_EDITOR_MESSAGES as M } from "./messages";
import { campaignListRows, serverSyncView, workspaceToolbar } from "./workspace-helpers";

/** The editor's state snapshot (one subscription per view that needs it). */
export const useCampaignEditorState = (editor: CampaignEditor): CampaignEditorState =>
  useSyncExternalStore(editor.subscribe, editor.getState, editor.getState);

/** Page frame: title, storage note, the owner-art confirmation, the status line and whether a campaign is open. */
export const useCampaignEditorApp = (editor: CampaignEditor) => {
  const { i18n } = useLingui();
  const state = useCampaignEditorState(editor);
  return {
    artworkConfirmed: state.artworkConfirmed,
    artworkLabel: translateMessage(i18n, M.fields.artworkConfirmed),
    backLabel: translateMessage(i18n, M.actions.backToMapEditor),
    hasSelection: state.draft !== null,
    loaded: state.loaded,
    memoryNote: state.storage === "memory" ? translateMessage(i18n, M.notes.memoryStorage) : "",
    noSelection: translateMessage(i18n, M.notes.noSelection),
    notice: state.notice && { error: state.notice.error, text: resolveEditorText(i18n, state.notice.text) },
    server: serverSyncView(state, i18n),
    title: translateMessage(i18n, M.sections.title)
  };
};

/** The campaign list rows with their badges and actions. */
export const useCampaignList = (editor: CampaignEditor) => {
  const { i18n } = useLingui();
  const state = useCampaignEditorState(editor);
  return {
    busy: state.busy,
    createLabel: translateMessage(i18n, M.actions.create),
    deleteLabel: translateMessage(i18n, M.actions.delete),
    emptyNote: translateMessage(i18n, M.notes.emptyList),
    renameLabel: translateMessage(i18n, M.actions.rename),
    rows: campaignListRows(state.campaigns, state.draft, state.dirty, i18n),
    title: translateMessage(i18n, M.sections.campaigns)
  };
};

/** The open campaign's toolbar: name, Draft/Ready and unsaved badges, Save, Check and the Ready switch. */
export const useWorkspaceToolbar = (editor: CampaignEditor) => {
  const { i18n } = useLingui();
  const state = useCampaignEditorState(editor);
  return workspaceToolbar(state, i18n);
};
