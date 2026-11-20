import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../../shared/i18n/translate";
import type { CampaignImageView } from "../campaign-editor-state";
import { CAMPAIGN_EDITOR_MESSAGES as M } from "../messages";

/** What an ImageUpload shows: the stored image (if any) and its labels. */
export interface ImageUploadView {
  disabled: boolean;
  label: string;
  removable: boolean;
  removeLabel: string;
  uploadAriaLabel: string;
  uploadLabel: string;
  url: string | null;
}

/**
 * The upload control of one image slot: disabled until the owner-art confirmation is ticked; `removable` is false
 * for required images (a speaker's neutral portrait).
 */
export const imageUploadView = (
  label: string, imageId: string | null | undefined, images: Readonly<Record<string, CampaignImageView>>,
  options: { artworkConfirmed: boolean; busy: boolean; removable: boolean }, i18n?: I18n
): ImageUploadView => {
  const url = imageId ? images[imageId]?.url ?? null : null;
  return {
    disabled: options.busy || !options.artworkConfirmed,
    label,
    removable: options.removable && url !== null,
    removeLabel: translateMessage(i18n, M.actions.removeImage),
    uploadAriaLabel: translateMessage(i18n, M.actions.uploadFor, { field: label }),
    uploadLabel: translateMessage(i18n, M.actions.upload),
    url
  };
};
