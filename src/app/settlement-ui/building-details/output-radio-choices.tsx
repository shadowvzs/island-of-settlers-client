import { useLingui } from "@lingui/react";
import { useId } from "react";

import { RANDOM_TOOLS } from "../../../shared/settlement/mixed-output";
import { WareIcon } from "../../components/ware-icon";
import { SETTLEMENT_MESSAGES as M } from "../messages";

interface OutputRadioChoice {
  disabled?: boolean;
  label: string;
  name: string;
  selected: boolean;
  title?: string;
  value: string;
  wares: readonly string[];
}

interface OutputRadioChoicesProps {
  choices: readonly OutputRadioChoice[];
  onSelect: (ware: string) => void;
}

/** Controlled native radios: the authoritative building selection determines the checked item. */
export const OutputRadioChoices = ({ choices, onSelect }: OutputRadioChoicesProps) => {
  const { i18n } = useLingui();
  const groupName = useId();
  return (
    <div aria-label={i18n._(M.details.production.chooseOutput)}
      data-tool-choices={choices.some(choice => choice.value === RANDOM_TOOLS) || undefined}
      role="radiogroup">
      {choices.map(choice => (
        <label className="settlement-ui__output-choice" key={choice.value} title={choice.title}>
          <input aria-label={choice.label} checked={choice.selected} disabled={choice.disabled}
            name={groupName} type="radio" value={choice.value} onChange={() => onSelect(choice.value)} />
          <span aria-hidden="true" className="settlement-ui__output-choice-icon">
            {choice.wares.map(ware => <WareIcon key={ware} ware={ware} />)}
          </span>
          <span>{choice.name}</span>
        </label>
      ))}
    </div>
  );
};
