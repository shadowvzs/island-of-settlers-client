import { clampWholeNumber } from "./number-stepper-helpers";
import { useNumberDraft } from "./use-number-draft";

interface NumberStepperProps {
  buttonClassName?: string;
  decreaseLabel: string;
  increaseLabel: string;
  label: string;
  max: number;
  min?: number;
  value: number;
  onChange: (value: number) => void;
}
/**
 * − / number field / + : every request is a whole number clamped to `min..max` before `onChange`
 * (the owner may clamp further, e.g. to a shared capacity). The field stays controlled and keeps focus.
 */
export const NumberStepper = ({
  buttonClassName = "settlement-ui__button", decreaseLabel, increaseLabel, label, max, min = 0, value, onChange
}: NumberStepperProps) => {
  const request = (wanted: number) => onChange(clampWholeNumber(wanted, min, Math.max(min, max)));
  const draft = useNumberDraft(value, request);
  return (
    <>
      <button aria-label={decreaseLabel} className={buttonClassName} type="button" onClick={() => request(value - 1)}>
        −
      </button>
      <input
        aria-label={label}
        max={max}
        min={min}
        step={1}
        type="number"
        value={draft.text}
        onBlur={draft.onBlur}
        onChange={event => draft.onInput(event.target.value)}
      />
      <button aria-label={increaseLabel} className={buttonClassName} type="button" onClick={() => request(value + 1)}>
        +
      </button>
    </>
  );
};
