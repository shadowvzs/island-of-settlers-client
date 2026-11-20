/** One colour of a swatch picker. */
export interface SwatchOption<T> {
  color: string;
  label: string;
  value: T;
}

/** A swatch ready to render: its colour, name and whether it is the chosen one. */
export interface SwatchRow<T> extends SwatchOption<T> {
  pressed: boolean;
}

export const getSwatchRows = <T>(choices: readonly SwatchOption<T>[], selected: T): SwatchRow<T>[] =>
  choices.map(choice => ({ ...choice, pressed: choice.value === selected }));
