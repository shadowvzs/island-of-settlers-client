import { getSwatchRows, type SwatchOption } from "./swatch-picker-helpers";

interface SwatchPickerProps<T> {
  choices: readonly SwatchOption<T>[];
  label: string;
  selected: T;
  onChange: (value: T) => void;
}
/**
 * A labelled row of round colour swatches: each a button named by its colour (title, aria-label), the chosen
 * one pressed; reports the chosen value.
 */
export const SwatchPicker = <T,>({ choices, label, selected, onChange }: SwatchPickerProps<T>) => (
  <div aria-label={label} className="settings-panel__swatches" role="group">
    <span>{label}</span>
    <div className="settings-panel__swatch-row">
      {getSwatchRows(choices, selected).map(swatch => (
        <button
          aria-label={swatch.label}
          aria-pressed={swatch.pressed}
          className="settings-panel__swatch"
          key={swatch.label}
          style={{ background: swatch.color }}
          title={swatch.label}
          type="button"
          onClick={() => onChange(swatch.value)}
        />
      ))}
    </div>
  </div>
);
