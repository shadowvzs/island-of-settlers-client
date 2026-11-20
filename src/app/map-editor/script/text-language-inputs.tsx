import type { QuestText } from "../../../../../island-of-settlers-shared/src/script/types/quest-text";
import { focusRef, type TextLanguageRow } from "./text-fields";
import { useQuestTextFields } from "./use-text-fields";

interface LanguageTagProps {
  row: TextLanguageRow;
}
/** The short language tag inside an input ("HU"); the input's name carries the full language. */
const LanguageTag = ({ row }: LanguageTagProps) => (
  <span aria-hidden="true" className="script-text__code" title={row.languageName}>{row.code}</span>
);

interface TextLanguageInputsProps {
  focusFirst?: boolean;
  rows: readonly TextLanguageRow[];
  onChange: (language: string, value: string) => void;
}
/** Controlled inputs, one per language side by side (the slot picker's text value). */
export const TextLanguageInputs = ({ focusFirst = false, rows, onChange }: TextLanguageInputsProps) => (
  <div className="script-text__languages">
    {rows.map((row, index) => (
      <label className="script-text__cell" key={row.language}>
        <LanguageTag row={row} />
        <input aria-label={row.label} ref={focusRef(focusFirst, index)} value={row.value}
          onChange={event => onChange(row.language, event.target.value)} />
      </label>
    ))}
  </div>
);

interface QuestTextFieldsProps {
  label: string;
  /** Characters per language of a single-line text (a name); unlimited when absent. */
  maxLength?: number;
  multiline?: boolean;
  text: QuestText;
  onCommit: (text: QuestText) => void;
}
/**
 * A form's text in every language on one row: uncontrolled inputs that commit on blur (one undo step per change);
 * a multiline text starts two lines tall and grows with its content.
 */
export const QuestTextFields = ({ label, maxLength, multiline = false, text, onCommit }: QuestTextFieldsProps) => {
  const view = useQuestTextFields(text, label, onCommit);
  return (
    <div aria-label={label} className="script-text" role="group">
      <span className="script-text__label">{label}</span>
      <div className="script-text__languages">
        {view.rows.map(row => (
          <label className="script-text__cell" key={`${row.language}:${row.value}`}>
            <LanguageTag row={row} />
            {multiline && <textarea aria-label={row.label} defaultValue={row.value} rows={2}
              onBlur={event => view.onBlur(row.language, event.target.value)} />}
            {!multiline && <input aria-label={row.label} defaultValue={row.value} maxLength={maxLength}
              onBlur={event => view.onBlur(row.language, event.target.value)} />}
          </label>
        ))}
      </div>
    </div>
  );
};
