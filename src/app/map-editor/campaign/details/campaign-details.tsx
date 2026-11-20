import { INPUT_SIZE_CLASSES } from "../../../components/input-sizes";
import type { CampaignEditor } from "../campaign-editor";
import { ImageUpload } from "../image-upload/image-upload";
import { StartMaps } from "../paths/start-maps/start-maps";
import { TranslationField } from "../translation/translation-field";
import { useCampaignDetails } from "./use-campaign-details";

interface CampaignDetailsProps {
  editor: CampaignEditor;
}
/** The campaign's metadata form. */
export const CampaignDetails = ({ editor }: CampaignDetailsProps) => {
  const view = useCampaignDetails(editor);
  return (
    <div className="campaign-editor__form">
      <TranslationField label={view.labels.name} text={view.name} onChange={view.onNameChange} />
      <TranslationField label={view.labels.description} multiline text={view.description}
        onChange={view.onDescriptionChange} />
      <div className="campaign-editor__inline-fields">
        <label className="campaign-editor__label">
          <span>{view.fromLabel}</span>
          <input className={INPUT_SIZE_CLASSES.short} type="date" value={view.availableFrom}
            onChange={event => view.onFromChange(event.target.value)} />
        </label>
        <label className="campaign-editor__label">
          <span>{view.untilLabel}</span>
          <input className={INPUT_SIZE_CLASSES.short} type="date" value={view.availableUntil}
            onChange={event => view.onUntilChange(event.target.value)} />
        </label>
      </div>
      <ImageUpload view={view.image} onRemove={view.onImageRemove} onUpload={view.onImageUpload} />
      <p className="campaign-editor__hint">{view.imageNote}</p>
      <StartMaps editor={editor} />
    </div>
  );
};
