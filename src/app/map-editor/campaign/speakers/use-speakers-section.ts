import { useLingui } from "@lingui/react";

import type { TranslatableText } from "../../../../../../island-of-settlers-shared/src/campaign/campaign-text";
import type { CampaignSpeaker } from "../../../../../../island-of-settlers-shared/src/campaign/cinematics/types";
import { translateMessage } from "../../../../shared/i18n/translate";
import type { CampaignEditor } from "../campaign-editor";
import { SPEAKER_EXPRESSIONS } from "../constants";
import { imageUploadView } from "../image-upload/helpers";
import { CAMPAIGN_EDITOR_MESSAGES as M } from "../messages";
import { useCampaignEditorState } from "../use-campaign-editor";
import {
  speakerSide, toSpeakerSide, withPortrait, withSpeaker, withSpeakerRemoved
} from "./helpers";

/** The campaign's recurring speakers (CIN1): name, side and one portrait per expression. */
export const useSpeakersSection = (editor: CampaignEditor) => {
  const { i18n } = useLingui();
  const state = useCampaignEditorState(editor);
  const uploadState = { artworkConfirmed: state.artworkConfirmed, busy: state.busy };
  const change = (id: string, update: (speaker: CampaignSpeaker) => CampaignSpeaker) =>
    editor.updateDraft(campaign => withSpeaker(campaign, id, update));
  const speakers = (state.draft?.speakers ?? []).map(speaker => ({
    id: speaker.id,
    name: speaker.name,
    portraits: SPEAKER_EXPRESSIONS.map(expression => ({
      expression,
      view: imageUploadView(translateMessage(i18n, M.expressions[expression]), speaker.portraits[expression],
        state.images, { ...uploadState, removable: expression !== "neutral" }, i18n),
      onRemove: () => change(speaker.id, entry => withPortrait(entry, expression, null)),
      onUpload: async (file: File) => {
        const imageId = await editor.uploadImage(file);
        if (imageId) change(speaker.id, entry => withPortrait(entry, expression, imageId));
      }
    })),
    side: speakerSide(speaker),
    onNameChange: (name: TranslatableText) => change(speaker.id, entry => ({ ...entry, name })),
    onRemove: () => editor.updateDraft(campaign => withSpeakerRemoved(campaign, speaker.id)),
    onSideChange: (value: string) => change(speaker.id, entry => ({ ...entry, side: toSpeakerSide(value) }))
  }));
  return {
    add: imageUploadView(translateMessage(i18n, M.actions.addSpeaker), null, state.images,
      { ...uploadState, removable: false }, i18n),
    emptyNote: translateMessage(i18n, M.notes.noSpeakers),
    labels: {
      left: translateMessage(i18n, M.fields.sideLeft),
      name: translateMessage(i18n, M.fields.name),
      remove: translateMessage(i18n, M.actions.remove),
      right: translateMessage(i18n, M.fields.sideRight),
      side: translateMessage(i18n, M.fields.side)
    },
    speakers,
    title: translateMessage(i18n, M.sections.speakers),
    onAdd: editor.addSpeaker
  };
};
