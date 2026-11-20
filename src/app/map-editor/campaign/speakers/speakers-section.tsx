import { INPUT_SIZE_CLASSES } from "../../../components/input-sizes";
import type { CampaignEditor } from "../campaign-editor";
import { ImageUpload } from "../image-upload/image-upload";
import { TranslationField } from "../translation/translation-field";
import { useSpeakersSection } from "./use-speakers-section";

interface SpeakersSectionProps {
  editor: CampaignEditor;
}

type SpeakersView = ReturnType<typeof useSpeakersSection>;

interface SpeakerCardProps {
  labels: SpeakersView["labels"];
  speaker: SpeakersView["speakers"][number];
}
/** One speaker: name (en + translations), panel side and the portrait per expression. */
const SpeakerCard = ({ labels, speaker }: SpeakerCardProps) => (
  <section aria-label={speaker.id} className="campaign-editor__card campaign-editor__speaker">
    <TranslationField label={labels.name} text={speaker.name} onChange={speaker.onNameChange} />
    <label className="campaign-editor__label campaign-editor__label--inline">
      <span>{labels.side}</span>
      <select className={INPUT_SIZE_CLASSES.short} value={speaker.side}
        onChange={event => speaker.onSideChange(event.target.value)}>
        <option value="left">{labels.left}</option>
        <option value="right">{labels.right}</option>
      </select>
    </label>
    <div className="campaign-editor__portraits">
      {speaker.portraits.map(portrait => (
        <ImageUpload key={portrait.expression} view={portrait.view} onRemove={portrait.onRemove}
          onUpload={portrait.onUpload} />
      ))}
    </div>
    <button className="campaign-editor__button campaign-editor__button--danger" type="button"
      onClick={speaker.onRemove}>{labels.remove}</button>
  </section>
);

/** The campaign's speakers list and the add-speaker upload (its neutral portrait). */
export const SpeakersSection = ({ editor }: SpeakersSectionProps) => {
  const view = useSpeakersSection(editor);
  return (
    <div className="campaign-editor__form">
      {!view.speakers.length && <p className="campaign-editor__hint">{view.emptyNote}</p>}
      {view.speakers.map(speaker => <SpeakerCard key={speaker.id} labels={view.labels} speaker={speaker} />)}
      <ImageUpload view={view.add} onUpload={view.onAdd} />
    </div>
  );
};
