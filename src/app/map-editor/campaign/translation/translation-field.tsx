import { LanguageFlag } from "../../../localization/language-choice";
import { closeOnEscape, type TranslationRow } from "./helpers";
import { type TranslationFieldOptions, useTranslationField } from "./use-translation-field";

interface TranslateButtonProps {
  controls: string;
  expanded: boolean;
  label: string;
  missing: boolean;
  onToggle: () => void;
}
/** The same translate icon after every translatable field; a dot marks a missing translation. */
export const TranslateButton = ({ controls, expanded, label, missing, onToggle }: TranslateButtonProps) => (
  <button aria-controls={controls} aria-expanded={expanded} className="campaign-editor__translate"
    data-missing={missing} title={label} type="button" onClick={onToggle}>
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M3 5h10M8 3v2m3 0c-1 4-4 7-7 8m3-5c1 2 3 4 6 5" />
      <path d="m12 21 4.5-10 4.5 10m-7.5-3.5h6" />
    </svg>
    <span className="campaign-editor__sr">{label}</span>
  </button>
);

interface TranslationInputProps {
  multiline: boolean;
  row: TranslationRow;
  onChange: (language: string, value: string) => void;
  onClose: () => void;
}
const TranslationInput = ({ multiline, row, onChange, onClose }: TranslationInputProps) => (
  <label className="campaign-editor__translation-row" data-missing={row.missing}>
    <span className="campaign-editor__language">
      {row.locale && <LanguageFlag locale={row.locale} />}
      {row.label}
    </span>
    {multiline && <textarea rows={4} value={row.value} onChange={event => onChange(row.language, event.target.value)}
      onKeyDown={event => closeOnEscape(event.key, onClose)} />}
    {!multiline && <input type="text" value={row.value} onChange={event => onChange(row.language, event.target.value)}
      onKeyDown={event => closeOnEscape(event.key, onClose)} />}
  </label>
);

interface TranslationPanelProps {
  id: string;
  multiline: boolean;
  rows: readonly TranslationRow[];
  title: string;
  onChange: (language: string, value: string) => void;
  onClose: () => void;
}
/** One input per language (single line for names/titles, textarea for texts so line breaks are kept). */
export const TranslationPanel = ({ id, multiline, rows, title, onChange, onClose }: TranslationPanelProps) => (
  <div aria-label={title} className="campaign-editor__translations" id={id} role="group">
    {rows.map(row => <TranslationInput key={row.language} multiline={multiline} row={row} onChange={onChange}
      onClose={onClose} />)}
  </div>
);

type TranslationFieldProps = TranslationFieldOptions & { multiline?: boolean };
/** A labelled translatable field: the default-language input, the TranslateButton and its TranslationPanel. */
export const TranslationField = ({ label, multiline = false, text, onChange }: TranslationFieldProps) => {
  const field = useTranslationField({ label, text, onChange });
  return (
    <div className="campaign-editor__field campaign-editor__field--translatable">
      <label className="campaign-editor__label">
        <span>{label}</span>
        <span className="campaign-editor__field-row">
          {multiline && <textarea rows={4} value={field.mainValue}
            onChange={event => field.onMainChange(event.target.value)} />}
          {!multiline && <input type="text" value={field.mainValue}
            onChange={event => field.onMainChange(event.target.value)} />}
        </span>
      </label>
      <TranslateButton controls={field.panelId} expanded={field.open} label={field.buttonLabel}
        missing={field.missingTranslation} onToggle={field.onToggle} />
      {field.missingTranslation && <p className="campaign-editor__hint">{field.missingNote}</p>}
      {field.open && <TranslationPanel id={field.panelId} multiline={multiline} rows={field.rows}
        title={field.buttonLabel} onChange={field.onLanguageChange} onClose={field.onClose} />}
    </div>
  );
};
