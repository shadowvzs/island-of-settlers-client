import type { I18n } from "@lingui/core";

import type {
  Campaign, CampaignPublicationState
} from "../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import { translateMessage } from "../../../shared/i18n/translate";
import type { CampaignEditorState, CampaignServerState } from "./campaign-editor-state";
import { displayText } from "./helpers";
import { CAMPAIGN_EDITOR_MESSAGES as M } from "./messages";

/** A Draft / Ready badge. */
export interface StateBadge {
  label: string;
  state: CampaignPublicationState;
}

export const stateBadge = (state: CampaignPublicationState, i18n?: I18n): StateBadge =>
  ({ label: translateMessage(i18n, M.badges[state]), state });

/** One campaign of the list: the selected one shows its working copy (name, state) and the unsaved mark. */
export interface CampaignListRow {
  badge: StateBadge;
  id: string;
  name: string;
  selected: boolean;
  unsaved: boolean;
}

export const campaignListRows = (
  campaigns: readonly Campaign[], draft: Campaign | null, dirty: boolean, i18n?: I18n
): CampaignListRow[] => campaigns.map(campaign => {
  const selected = campaign.id === draft?.id;
  const shown = selected && draft ? draft : campaign;
  return {
    badge: stateBadge(shown.state, i18n),
    id: campaign.id,
    name: displayText(shown.name, i18n?.locale ?? "en", campaign.id),
    selected,
    unsaved: selected && dirty
  };
});

/** Badge tone (the Draft/Ready/unsaved colours) and label of each server sync state. */
const SERVER_BADGES = {
  connected: { label: M.badges.serverConnected, tone: "ready" },
  failed: { label: M.badges.serverFailed, tone: "unsaved" },
  none: { label: M.badges.serverNone, tone: "draft" }
} as const satisfies Record<CampaignServerState, unknown>;

/** The header's server sync control: badge, icon button tooltip and whether a sync can start. */
export const serverSyncView = ({ busy, server }: Pick<CampaignEditorState, "busy" | "server">, i18n?: I18n) => {
  const { label, tone } = SERVER_BADGES[server];
  return {
    badge: translateMessage(i18n, label),
    disabled: busy || server === "none",
    tone,
    tooltip: translateMessage(i18n, server === "none" ? M.notes.serverNone : M.actions.syncWithServer)
  };
};

/** The open campaign's toolbar labels and switches. */
export const workspaceToolbar = (state: CampaignEditorState, i18n?: I18n) => {
  const draft = state.draft;
  const ready = draft?.state === "ready";
  return {
    badge: stateBadge(draft?.state ?? "draft", i18n),
    busy: state.busy,
    checkLabel: translateMessage(i18n, M.actions.check),
    dirty: state.dirty,
    name: draft ? displayText(draft.name, i18n?.locale ?? "en", draft.id) : "",
    ready,
    readyLabel: translateMessage(i18n, ready ? M.actions.markDraft : M.actions.markReady),
    readyNote: ready ? translateMessage(i18n, M.notes.readyEdits) : "",
    saveLabel: translateMessage(i18n, M.actions.save),
    /** A Check panel jump as the tab list's request (same object until the next jump). */
    tabRequest: state.jump && { id: state.jump.tab, revision: state.jump.revision },
    tabsLabel: translateMessage(i18n, M.sections.tabs),
    unsavedLabel: translateMessage(i18n, M.badges.unsaved)
  };
};

/** The section tabs of an open campaign, in order. */
export const workspaceTabLabels = (i18n?: I18n) => ({
  details: translateMessage(i18n, M.sections.details),
  maps: translateMessage(i18n, M.sections.maps),
  mapView: translateMessage(i18n, M.sections.mapView),
  speakers: translateMessage(i18n, M.sections.speakers),
  story: translateMessage(i18n, M.sections.story),
  translations: translateMessage(i18n, M.sections.translations),
  validation: translateMessage(i18n, M.sections.validation)
});
