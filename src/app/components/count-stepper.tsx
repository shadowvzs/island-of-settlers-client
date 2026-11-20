interface CountStepperProps {
  count: string;
  /** Accessible name of the shown count (an `<output>`, read by `getByLabel`). */
  countLabel: string;
  decreaseDisabled?: boolean;
  decreaseLabel: string;
  /** Tooltip of −; the label by default (e.g. why the last soldier must stay). */
  decreaseTitle?: string;
  increaseDisabled?: boolean;
  increaseLabel: string;
  onDecrease: () => void;
  onIncrease: () => void;
}
/**
 * − / count / + without a typed field (garrison, armory orders, tavern recruits): the owner applies each
 * step through its command or draft and passes the result back as `count`. Unlike `NumberStepper` the
 * count is read-only output, so a tick never touches an input. Renders siblings for the owner's grid.
 */
export const CountStepper = ({
  count, countLabel, decreaseDisabled, decreaseLabel, decreaseTitle = decreaseLabel, increaseDisabled,
  increaseLabel, onDecrease, onIncrease
}: CountStepperProps) => (
  <>
    <button
      aria-label={decreaseLabel}
      disabled={decreaseDisabled}
      title={decreaseTitle}
      type="button"
      onClick={onDecrease}
    >
      −
    </button>
    <output aria-label={countLabel}>{count}</output>
    <button
      aria-label={increaseLabel}
      disabled={increaseDisabled}
      title={increaseLabel}
      type="button"
      onClick={onIncrease}
    >
      +
    </button>
  </>
);
