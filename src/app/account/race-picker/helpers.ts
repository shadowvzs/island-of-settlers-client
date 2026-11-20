import type { I18n, MessageDescriptor } from "@lingui/core";

import type { WorkerNation } from "../../../render-common/workers/worker-nation";
import { translateMessage } from "../../../shared/i18n/translate";
import { ACCOUNT_MESSAGES } from "../messages";
import { nationTooltip } from "./nation-tooltip";

const helmets = import.meta.glob<string>("../../../../assets/ui-icons/races/*.png", {
  eager: true,
  import: "default",
  query: "?url"
});

const buildingIcons = import.meta.glob<string>("../../../../assets/building-icons/*-0.png", {
  eager: true, import: "default", query: "?url"
});

/** Established nations retain their order; building-first additions follow them. */
export const RACES: readonly { label: string; message: MessageDescriptor; nation: WorkerNation }[] = [
  { label: "Roman", message: ACCOUNT_MESSAGES.race.roman, nation: "roman" },
  { label: "Viking", message: ACCOUNT_MESSAGES.race.viking, nation: "viking" },
  { label: "Japanese", message: ACCOUNT_MESSAGES.race.japanese, nation: "japanese" },
  { label: "Nubian", message: ACCOUNT_MESSAGES.race.nubian, nation: "nubian" },
  { label: "Indigenous", message: ACCOUNT_MESSAGES.race.indigenous, nation: "indigenous" },
  { label: "Chinese", message: ACCOUNT_MESSAGES.race.chinese, nation: "chinese" },
  { label: "Persian", message: ACCOUNT_MESSAGES.race.persian, nation: "persian" },
  { label: "Classic Maya", message: ACCOUNT_MESSAGES.race.maya, nation: "maya" }
];

/** "large": registration scroll; "compact": development panel. */
export type RacePickerSize = "compact" | "large";

/** One helmet button, ready to render. */
export interface RaceOption {
  checked: boolean;
  helmet: string;
  index: number;
  label: string;
  nation: WorkerNation;
  /** Only the checked button (the first one while none is) is in the tab order. */
  tabIndex: number;
  /** Localized nation name and both canonical national advantages. */
  tooltip: string;
}

export const getRacePickerClassName = (size: RacePickerSize) => `race-picker race-picker--${size}`;

export const getHelmetUrl = (nation: WorkerNation) => {
  return helmets[`../../../../assets/ui-icons/races/${nation}.png`] ??
    buildingIcons[`../../../../assets/building-icons/${nation}-0.png`] ??
    helmets["../../../../assets/ui-icons/races/roman.png"]!;
};

export const getRaceOptions = (selected: WorkerNation | null, i18n?: I18n): RaceOption[] =>
  RACES.map((race, index) => {
    const checked = race.nation === selected;
    const tabbable = checked || (!selected && index === 0);
    const label = translateMessage(i18n, race.message);
    return {
      checked,
      helmet: getHelmetUrl(race.nation),
      index,
      label,
      nation: race.nation,
      tabIndex: tabbable ? 0 : -1,
      tooltip: nationTooltip(race.nation, label, i18n)
    };
  });

/** Focuses the button in the tab order of a picker (the checked helmet, else the first). */
export const focusRacePicker = (group: HTMLElement | null) =>
  group?.querySelector<HTMLButtonElement>('.race-picker__option[tabindex="0"]')?.focus();
