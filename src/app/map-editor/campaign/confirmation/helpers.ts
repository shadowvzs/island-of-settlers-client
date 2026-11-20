import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../../shared/i18n/translate";
import type { CampaignDeleteConfirmation } from "../campaign-editor-state";
import { CAMPAIGN_EDITOR_MESSAGES as M } from "../messages";

/** What a campaign deletion removes: its maps, their map files and its images (empty counts are left out). */
const campaignItems = (confirmation: CampaignDeleteConfirmation, i18n?: I18n) => [
  { count: confirmation.mapCount, message: M.confirm.deleteMapRecords },
  { count: confirmation.mapCount, message: M.confirm.deleteMapFiles },
  { count: confirmation.imageCount, message: M.confirm.deleteImages }
].filter(item => item.count > 0).map(item => translateMessage(i18n, item.message, { count: item.count }));

const mapItems = (i18n?: I18n) => [
  translateMessage(i18n, M.confirm.deleteMapRecords, { count: 1 }),
  translateMessage(i18n, M.confirm.deleteMapFiles, { count: 1 })
];

/** The confirmation panel's copy: a title naming the subject, the counted list, notes and the two buttons. */
export const deleteConfirmationView = (confirmation: CampaignDeleteConfirmation, i18n?: I18n) => {
  const isCampaign = confirmation.kind === "campaign";
  const notes = [translateMessage(i18n, M.confirm.deleteUndo)];
  if (!isCampaign) notes.push(translateMessage(i18n, M.confirm.deleteMapSaveNote));
  return {
    cancelLabel: translateMessage(i18n, M.actions.cancel),
    confirmLabel: translateMessage(i18n, isCampaign ? M.actions.deleteCampaign : M.actions.deleteMap),
    intro: translateMessage(i18n, M.confirm.deleteIntro),
    items: isCampaign ? campaignItems(confirmation, i18n) : mapItems(i18n),
    key: `${confirmation.kind}:${confirmation.id}`,
    notes,
    title: translateMessage(i18n, isCampaign ? M.confirm.deleteCampaignTitle : M.confirm.deleteMapTitle,
      { name: confirmation.name })
  };
};

export type DeleteConfirmationView = ReturnType<typeof deleteConfirmationView>;
