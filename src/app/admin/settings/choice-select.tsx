import type { ChoiceView } from "./view-model";

interface ChoiceSelectProps<T extends string> {
  choices: readonly ChoiceView<T>[];
  label: string;
  selected: T;
  onChange: (value: T) => void;
}
/** A compact labelled select over string choices; a disabled option keeps its reason as tooltip. */
export const ChoiceSelect = <T extends string>({ choices, label, selected, onChange }: ChoiceSelectProps<T>) => (
  <label className="admin-settings__field">
    <span>{label}</span>
    <select value={selected} onChange={event => onChange(event.target.value as T)}>
      {choices.map(choice => (
        <option disabled={choice.disabled} key={choice.value} title={choice.title} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  </label>
);

interface NumberFieldProps {
  label: string;
  max: number;
  min: number;
  value: number;
  onChange: (value: number) => void;
}
/** A small whole-number field; out-of-range values reach the draft and show as a validation issue. */
export const NumberField = ({ label, max, min, value, onChange }: NumberFieldProps) => (
  <label className="admin-settings__field admin-settings__field--number">
    <span>{label}</span>
    <input max={max} min={min} step={1} type="number" value={value}
      onChange={event => onChange(Math.trunc(Number(event.target.value)))} />
  </label>
);
