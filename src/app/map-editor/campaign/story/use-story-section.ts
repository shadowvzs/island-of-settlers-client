import { useLingui } from "@lingui/react";
import { useState } from "react";

import type { TranslatableText } from "../../../../../../island-of-settlers-shared/src/campaign/campaign-text";
import { translateMessage } from "../../../../shared/i18n/translate";
import type { ResolveCampaignImage } from "../../../campaign/helpers";
import type { CampaignEditor } from "../campaign-editor";
import { STORY_KINDS, type StoryKind } from "../constants";
import { imageUploadView } from "../image-upload/helpers";
import { mapListRows } from "../map-list/helpers";
import { CAMPAIGN_EDITOR_MESSAGES as M } from "../messages";
import { useCampaignEditorState } from "../use-campaign-editor";
import { storyFieldsOf, storyPreviewContent, withStoryFields } from "./helpers";

/** The Story tab: the selected map's intro and epilogue forms and the Preview of the real story panel. */
export const useStorySection = (editor: CampaignEditor) => {
  const { i18n } = useLingui();
  const state = useCampaignEditorState(editor);
  const [preview, setPreview] = useState<StoryKind | null>(null);
  const map = state.maps.find(entry => entry.id === state.selectedMapId) ?? null;
  const resolveImage: ResolveCampaignImage = imageId => state.images[imageId]?.url ?? null;
  const uploadOptions = { artworkConfirmed: state.artworkConfirmed, busy: state.busy, removable: true };
  const forms = map ? STORY_KINDS.map(kind => {
    const fields = storyFieldsOf(map, kind);
    const change = (patch: Parameters<typeof withStoryFields>[2]) =>
      editor.updateMap(map.id, entry => withStoryFields(entry, kind, patch));
    return {
      ...fields,
      heading: translateMessage(i18n, M.sections[kind]),
      image: imageUploadView(translateMessage(i18n, M.fields.storyImage), fields.imageId, state.images, uploadOptions,
        i18n),
      kind,
      onImageRemove: () => change({ imageId: null }),
      onImageUpload: async (file: File) => {
        const imageId = await editor.uploadImage(file);
        if (imageId) change({ imageId });
      },
      onPreview: () => setPreview(kind),
      onTextChange: (text: TranslatableText) => change({ text }),
      onTitleChange: (title: TranslatableText) => change({ title })
    };
  }) : [];
  return {
    emptyNote: translateMessage(i18n, M.notes.noMapSelected),
    forms,
    labels: {
      closePreview: translateMessage(i18n, M.actions.closePreview),
      map: translateMessage(i18n, M.sections.mapSettings),
      preview: translateMessage(i18n, M.actions.preview),
      text: translateMessage(i18n, M.fields.storyText),
      title: translateMessage(i18n, M.fields.storyTitle)
    },
    mapChoices: mapListRows(state.draft!, state.maps, state.selectedMapId, i18n.locale),
    preview: map && preview ? { content: storyPreviewContent(map, preview), key: `${map.id}:${preview}` } : null,
    resolveImage,
    selectedMapId: map?.id ?? "",
    onClosePreview: () => setPreview(null),
    onSelectMap: editor.selectMap
  };
};
