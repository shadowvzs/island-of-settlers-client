import type { I18n } from "@lingui/core";

import { getRoadDecorationItem } from "../../../../island-of-settlers-shared/src/road-decoration-items";
import { translateMessage } from "../../shared/i18n/translate";
import type { PlayerItemId } from "../../shared/progression/player-inventory";
import { INVENTORY_MESSAGES as M } from "./messages";
import { plantItemDetails } from "./plant-presentation";
import { roadDecorationFinishMessage, roadDecorationMessages } from "./road-decoration-presentation";

export const itemMessages = (id:PlayerItemId) => {
  const decoration = roadDecorationMessages(id);
  if (decoration) return decoration;
  if (id === "commanderRecovery") return { name:M.recoveryName,description:M.recoveryDescription };
  return { name:M.chooseNation,description:M.description };
};
/** Finish variants retain distinct readable names wherever a private item is shown. */
export const playerItemName = (id: PlayerItemId, i18n?: I18n) => {
  const name = translateMessage(i18n, itemMessages(id).name), finish = roadDecorationFinishMessage(id);
  const plant = getRoadDecorationItem(id)?.plant;
  if (plant) return `${name} · ${plantItemDetails(plant, i18n)}`;
  return finish ? `${name} · ${translateMessage(i18n, finish)}` : name;
};
