import { useLingui } from "@lingui/react";

import type { TranslatableText } from "../../../../../../island-of-settlers-shared/src/campaign/campaign-text";
import { translateMessage } from "../../../../shared/i18n/translate";
import type { CampaignEditor } from "../campaign-editor";
import { availabilityFromInputs, availabilityInputs } from "../helpers";
import { imageUploadView } from "../image-upload/helpers";
import { CAMPAIGN_EDITOR_MESSAGES as M } from "../messages";
import { useCampaignEditorState } from "../use-campaign-editor";

/** Campaign metadata: names, description, availability window (UTC dates) and the campaign map image. */
export const useCampaignDetails = (editor: CampaignEditor) => {
  const { i18n } = useLingui();
  const state = useCampaignEditorState(editor);
  const draft = state.draft!;
  const availability = availabilityInputs(draft.availability);
  const setText = (field: "description" | "name") => (text: TranslatableText) =>
    editor.updateDraft(campaign => ({ ...campaign, [field]: text }));
  const setAvailability = (from: string, until: string) =>
    editor.updateDraft(campaign => ({ ...campaign, availability: availabilityFromInputs(from, until) }));
  return {
    availableFrom: availability.from,
    availableUntil: availability.until,
    description: draft.description,
    fromLabel: translateMessage(i18n, M.fields.availableFrom),
    image: imageUploadView(translateMessage(i18n, M.sections.mapView), draft.imageId, state.images,
      { artworkConfirmed: state.artworkConfirmed, busy: state.busy, removable: true }, i18n),
    imageNote: translateMessage(i18n, M.notes.uploadLimits),
    labels: {
      description: translateMessage(i18n, M.fields.description), name: translateMessage(i18n, M.fields.name)
    },
    name: draft.name,
    title: translateMessage(i18n, M.sections.details),
    untilLabel: translateMessage(i18n, M.fields.availableUntil),
    onDescriptionChange: setText("description"),
    onFromChange: (value: string) => setAvailability(value, availability.until),
    onImageRemove: () => editor.updateDraft(({ imageId: _removed, ...campaign }) => campaign),
    onImageUpload: async (file: File) => {
      const imageId = await editor.uploadImage(file);
      if (imageId) editor.updateDraft(campaign => ({ ...campaign, imageId }));
    },
    onNameChange: setText("name"),
    onUntilChange: (value: string) => setAvailability(availability.from, value)
  };
};
