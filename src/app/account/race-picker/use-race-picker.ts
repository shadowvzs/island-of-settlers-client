import type { I18n } from "@lingui/core";
import { type KeyboardEvent, useRef } from "react";

import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { getNextRovingIndex } from "../../components/helpers";
import { getRaceOptions, RACES } from "./helpers";

interface RacePickerState {
  disabledNation?: WorkerNation;
  i18n?: I18n;
  selected: WorkerNation | null;
  onSelect: (nation: WorkerNation) => void;
}

/** Helmet rows of the picker; a click, an arrow key or Home / End chooses (keys also move the focus). */
export const useRacePicker = ({ disabledNation, i18n, onSelect, selected }: RacePickerState) => {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const choose = (index: number) => {
    const nation = RACES[index]!.nation;
    if (nation !== selected && nation !== disabledNation) onSelect(nation);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = getNextRovingIndex(event.key, index, RACES.length);
    if (next === null) return;
    event.preventDefault();
    if (RACES[next]?.nation === disabledNation) {
      const direction = event.key === "End" || event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      next = (next + direction + RACES.length) % RACES.length;
    }
    buttons.current[next]?.focus();
    choose(next);
  };
  const bindButton = (index: number) => (button: HTMLButtonElement | null) => { buttons.current[index] = button; };
  const options = getRaceOptions(selected, i18n);
  if (!selected && disabledNation) {
    const first = options.find(option=>option.nation !== disabledNation);
    for (const option of options) option.tabIndex = option === first ? 0 : -1;
  }
  return { bindButton, choose, onKeyDown, options };
};
