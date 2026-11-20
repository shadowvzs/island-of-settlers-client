import type { ModeChoiceView } from "./production-mode-helpers";

interface ProductionModeChoicesProps<Mode extends string> {
  choices: readonly ModeChoiceView<Mode>[];
  /** The paragraph that explains the selected mode. */
  helpId: string;
  onChange: (mode: Mode) => void;
}
/** The shared two-mode button row (Shipyard boats/ships, Fishery rod/boat). */
export const ProductionModeChoices = <Mode extends string>(
  { choices, helpId, onChange }: ProductionModeChoicesProps<Mode>
) => (
  <div className="settlement-ui__mode-choices">
    {choices.map(choice => (
      <button aria-describedby={helpId} aria-disabled={choice.disabled} aria-label={choice.ariaLabel}
        aria-pressed={choice.pressed} className="settlement-ui__button" key={choice.value}
        title={choice.description} type="button" onClick={() => onChange(choice.value)}>
        <img alt="" aria-hidden="true" className="settlement-art-icon" draggable={false} src={choice.iconSource} />
        <small>{choice.label}</small>
      </button>
    ))}
  </div>
);
