import type { I18n, MessageDescriptor, Values } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { translateMessage } from "../../../shared/i18n/translate";
import {
  NATION_BONUSES, type NationEconomyBonus, type NationMilitaryBonus, type NationTroop
} from "../../../shared/settlement/nation-bonuses";

const percent = (share: number) => Math.round(share * 100);
interface Copy { descriptor: MessageDescriptor; values: Values }

const economyCopy = (bonus: NationEconomyBonus): Copy => {
  if (bonus.kind === "construction") {
    const share = percent(bonus.constructionShare);
    return { descriptor: msg`+${share}% construction speed`, values: { share } };
  }
  const share = percent(bonus.share);
  if (bonus.scope === "drink")
    return { descriptor: msg`+${share}% national drink production speed`, values: { share } };
  if (bonus.scope === "farms")
    return { descriptor: msg`+${share}% farm and drink production speed`, values: { share } };
  if (bonus.scope === "hunter")
    return { descriptor: msg`+${share}% hunting, fishing and drink production speed`, values: { share } };
  if (bonus.scope === "mines")
    return { descriptor: msg`+${share}% mine and quarry production speed`, values: { share } };
  return { descriptor: msg`+${share}% woodcutting speed`, values: { share } };
};

const troopMessages: Readonly<Record<NationTroop, MessageDescriptor>> = {
  archer: msg`archers`,
  heavy: msg`heavy infantry`,
  shield: msg`shield infantry`
};
const troopLabel = (i18n: I18n | undefined, troops: readonly NationTroop[]) => {
  if (troops.length === 3) return translateMessage(i18n, msg`all soldiers`);
  if (troops.length === 2 && troops.includes("heavy") && troops.includes("shield"))
    return translateMessage(i18n, msg`heavy and shield infantry`);
  return troops.map(troop => translateMessage(i18n, troopMessages[troop])).join(" / ");
};

const militaryCopy = (bonus: NationMilitaryBonus, i18n: I18n | undefined): Copy => {
  if (bonus.kind === "archer-double") {
    const chance = percent(bonus.chance);
    return { descriptor: msg`${chance}% chance for archer shots to deal double damage`, values: { chance } };
  }
  if (bonus.kind === "archer-damage") {
    const share = percent(bonus.share);
    return { descriptor: msg`+${share}% archer damage`, values: { share } };
  }
  if (bonus.kind === "movement") {
    const share = percent(bonus.share);
    return { descriptor: msg`+${share}% military movement speed`, values: { share } };
  }
  if (bonus.kind === "range") {
    const share = percent(bonus.share);
    return { descriptor: msg`+${share}% archer range`, values: { share } };
  }
  const share = percent(bonus.share), troops = troopLabel(i18n, bonus.troops);
  return bonus.kind === "damage"
    ? { descriptor: msg`+${share}% damage for ${troops}`, values: { share, troops } }
    : { descriptor: msg`+${share}% health for ${troops}`, values: { share, troops } };
};

/** One canonical localized hover tooltip for every nation icon: name, economy and military. */
export const nationTooltip = (nation: WorkerNation, label: string, i18n?: I18n) => {
  const bonus = NATION_BONUSES[nation];
  const economy = economyCopy(bonus.economy), military = militaryCopy(bonus.military, i18n);
  return [
    label,
    translateMessage(i18n, msg`Economy:`) + " " + translateMessage(i18n, economy.descriptor, economy.values),
    translateMessage(i18n, msg`Military:`) + " " + translateMessage(i18n, military.descriptor, military.values)
  ].join("\n");
};
