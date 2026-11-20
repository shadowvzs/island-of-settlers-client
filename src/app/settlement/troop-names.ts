import type { I18n } from "@lingui/core";

import { displayTroopName } from "../../shared/i18n/domain";
import type { MilitaryTroopType } from "../../shared/settlement/military-combat-rules";

/** One soldier of the type in the nation's roster ("Longswordsman"). */
export const troopName = (nation: string, type: MilitaryTroopType, i18n?: I18n) =>
  displayTroopName(nation, type, false, i18n);

/** Several soldiers of the type in the nation's roster ("Longswordsmen"). */
export const troopPluralName = (nation: string, type: MilitaryTroopType, i18n?: I18n) =>
  displayTroopName(nation, type, true, i18n);
