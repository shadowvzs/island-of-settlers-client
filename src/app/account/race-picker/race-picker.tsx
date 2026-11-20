import { useLingui } from "@lingui/react";
import type { Ref } from "react";

import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { getRacePickerClassName, type RacePickerSize } from "./helpers";
import { useRacePicker } from "./use-race-picker";

import "./race-picker.css";

interface RacePickerProps {
  describedBy?: string;
  disabled?: boolean;
  disabledNation?: WorkerNation;
  groupRef?: Ref<HTMLDivElement>;
  /** Accessible name of the radio group. */
  label: string;
  selected: WorkerNation | null;
  size: RacePickerSize;
  onSelect: (nation: WorkerNation) => void;
}

/**
 * Radio group of nation model buttons (registration and the development panel). The checked
 * button carries `aria-checked="true"`; only it is in the tab order.
 */
export const RacePicker = ({
  describedBy, disabled = false, disabledNation, groupRef, label, selected, size, onSelect
}: RacePickerProps) => {
  const { i18n } = useLingui();
  const { bindButton, choose, onKeyDown, options } = useRacePicker({ disabledNation, i18n, selected, onSelect });
  return (
    <div
      aria-describedby={describedBy}
      aria-label={label}
      className={getRacePickerClassName(size)}
      ref={groupRef}
      role="radiogroup"
    >
      {options.map(option => (
        <button
          aria-checked={option.checked}
          aria-label={option.label}
          className="race-picker__option"
          data-nation={option.nation}
          disabled={disabled || option.nation === disabledNation}
          key={option.nation}
          ref={bindButton(option.index)}
          role="radio"
          tabIndex={option.tabIndex}
          title={option.tooltip}
          type="button"
          onClick={() => choose(option.index)}
          onKeyDown={event => onKeyDown(event, option.index)}
        >
          <img alt="" className="race-picker__helmet" draggable={false} src={option.helmet} />
          <span className="race-picker__name">{option.label}</span>
        </button>
      ))}
    </div>
  );
};
