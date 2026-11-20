import { getChoiceIndex, getChoiceValue, type SelectOption } from "./helpers";
import { type InfoContent, InlineInfo } from "./info-hint";

interface SelectProps<T> {
  choices: readonly SelectOption<T>[];
  info?: InfoContent;
  label: string;
  name?: string;
  selected: T;
  title?: string;
  onChange: (value: T) => void;
}
/**
 * Labelled select: option values are indices; reports the choice's value.
 * The select repeats its label as `aria-label` (same accessible name) so exact label queries match it.
 */
export const Select = <T,>({ choices, info, label, name, selected, title, onChange }: SelectProps<T>) => {
  const select = (
    <label className="settings-panel__select" title={title}>
      {label}
      <select
        aria-label={label}
        name={name}
        value={getChoiceIndex(choices, selected)}
        onChange={event => onChange(getChoiceValue(choices, event.target.value))}
      >
        {choices.map((choice, index) => <option key={choice.label} value={index}>{choice.label}</option>)}
      </select>
    </label>
  );
  if (!info) return select;
  return (
    <div className="settings-panel__control-row settings-panel__control-row--select">
      {select}
      <InlineInfo info={info} />
    </div>
  );
};
