import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../shared/i18n/translate";
import { IconButton } from "../../components/icon-button";
import { NumberStepper } from "../../components/number-stepper";
import { WareIcon } from "../../components/ware-icon";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { PickerChoice, PickerView } from "./place-offer-helpers";

interface WareChoiceButtonProps {
  choice: PickerChoice;
  onPick: (ware: string) => void;
}
const WareChoiceButton = ({ choice, onPick }: WareChoiceButtonProps) => (
  <button
    aria-label={choice.label}
    aria-pressed={choice.selected}
    className="trade-office__ware"
    data-ware={choice.ware}
    type="button"
    onClick={() => onPick(choice.ware)}
  >
    <WareIcon title={choice.label} ware={choice.ware} />
    <small>{choice.available}</small>
  </button>
);

interface AmountControlsProps {
  amount: number;
  label: string;
  max: number;
  onAmount: (amount: number) => void;
}
/** Typed amount (− / field / +) and a themed slider over 1..max. */
const AmountControls = ({ amount, label, max, onAmount }: AmountControlsProps) => {
  const { i18n } = useLingui();
  return (
  <div className="trade-office__amount">
    <div className="trade-office__stepper">
      <NumberStepper
        decreaseLabel={i18n._(M.trade.less)}
        increaseLabel={i18n._(M.trade.more)}
        label={label}
        max={max}
        min={1}
        value={amount}
        onChange={onAmount}
      />
    </div>
    <input
      aria-label={translateMessage(i18n, M.trade.slider, { label })}
      className="trade-office__slider"
      max={max}
      min={1}
      step={1}
      type="range"
      value={amount}
      onChange={event => onAmount(Number(event.target.value))}
    />
  </div>
  );
};

interface WarePickerProps {
  picker: PickerView;
  onAmount: (amount: number) => void;
  onDone: () => void;
  onPick: (ware: string) => void;
}
/** Ware icon grid of one side with the amount for the chosen ware. */
export const WarePicker = ({ picker, onAmount, onDone, onPick }: WarePickerProps) => {
  const { i18n } = useLingui();
  return (
  <fieldset className="trade-office__picker" id={picker.id}>
    <legend>{picker.heading}</legend>
    <div className="trade-office__wares">
      {picker.choices.map(choice => (
        <WareChoiceButton choice={choice} key={choice.ware} onPick={onPick} />
      ))}
    </div>
    {picker.emptyText && <p className="trade-office__empty">{picker.emptyText}</p>}
    {picker.chosen && (
      <AmountControls amount={picker.amount} label={picker.amountLabel} max={picker.max} onAmount={onAmount} />
    )}
    <IconButton caption={i18n._(M.common.done)} className="trade-office__done" icon="apply"
      label={i18n._(M.common.done)} onClick={onDone} />
  </fieldset>
  );
};
