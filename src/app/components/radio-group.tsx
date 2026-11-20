import { useId } from "react";

import type { SelectOption } from "./helpers";

interface RadioGroupProps<T> {
  choices: readonly SelectOption<T>[];
  label: string;
  selected: T;
  onChange: (value: T) => void;
}
/** Paper radio setting: a labelled group of native radios, one per choice. */
export const RadioGroup = <T,>({ choices, label, selected, onChange }: RadioGroupProps<T>) => {
  const groupName = useId();
  return (
    <fieldset aria-label={label} className="settings-panel__radio-group">
      <legend>{label}</legend>
      {choices.map(choice => (
        <label className="settings-panel__check" key={String(choice.value)}>
          <input checked={choice.value === selected} name={groupName} type="radio"
            onChange={() => onChange(choice.value)} />
          {choice.label}
        </label>
      ))}
    </fieldset>
  );
};
