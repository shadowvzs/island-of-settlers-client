import { StoryPanel } from "../../../campaign/story-panel/story-panel";
import type { CampaignEditor } from "../campaign-editor";
import { ImageUpload } from "../image-upload/image-upload";
import { TranslationField } from "../translation/translation-field";
import { useStorySection } from "./use-story-section";

import "../../../settlement-ui/styles.css";
import "../../../settlement-ui/colony.css";

interface StorySectionProps {
  editor: CampaignEditor;
}

type StoryView = ReturnType<typeof useStorySection>;

interface StoryFormProps {
  form: StoryView["forms"][number];
  labels: StoryView["labels"];
}
/** One story message: title, text (en + translations), the story image and its Preview. */
const StoryForm = ({ form, labels }: StoryFormProps) => (
  <section aria-label={form.heading} className="campaign-editor__card">
    <h3>{form.heading}</h3>
    <TranslationField label={labels.title} text={form.title} onChange={form.onTitleChange} />
    <TranslationField label={labels.text} multiline text={form.text} onChange={form.onTextChange} />
    <ImageUpload view={form.image} onRemove={form.onImageRemove} onUpload={form.onImageUpload} />
    <button className="campaign-editor__button campaign-editor__button--primary" type="button"
      onClick={form.onPreview}>{labels.preview}</button>
  </section>
);

/** The selected map's intro and epilogue; Preview renders the real C11a story panel over the editor. */
export const StorySection = ({ editor }: StorySectionProps) => {
  const view = useStorySection(editor);
  return (
    <div className="campaign-editor__form">
      <label className="campaign-editor__label">
        <span>{view.labels.map}</span>
        <select value={view.selectedMapId} onChange={event => view.onSelectMap(event.target.value)}>
          {view.mapChoices.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
        </select>
      </label>
      {!view.forms.length && <p className="campaign-editor__hint">{view.emptyNote}</p>}
      <div className="campaign-editor__columns">
        {view.forms.map(form => <StoryForm form={form} key={form.kind} labels={view.labels} />)}
      </div>
      {view.preview && (
        <div className="campaign-editor__preview">
          <div className="settlement-popup">
            <StoryPanel content={view.preview.content} key={view.preview.key} resolveImage={view.resolveImage}
              onClose={view.onClosePreview} onRetryClaim={view.onClosePreview} />
          </div>
        </div>
      )}
    </div>
  );
};
