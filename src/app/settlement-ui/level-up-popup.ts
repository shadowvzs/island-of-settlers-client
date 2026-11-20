import type { I18n } from "@lingui/core";

import { getNationBuildingDefinition } from "../../render-common/buildings/nation-building-text";
import { translateMessage } from "../../shared/i18n/translate";
import { buildingsUnlockedAt } from "../../shared/progression/building-unlocks";
import type { LevelUp } from "../../shared/progression/player-progress";
import { homeChapterName } from "../../shared/quests/home-quest-text";
import { imageArt } from "./art-helpers";
import { SETTLEMENT_MESSAGES as M } from "./messages";
import { progressionIcon } from "./player-hud-helpers";
import type { SettlementPopupAction, SettlementPopupContent } from "./settlement-popup";

type OpenBuildMenu = (types: readonly number[]) => void;

/** The buildings every crossed level unlocks, with the player's nation names. */
const getUnlockedBuildings = (levelUps: readonly LevelUp[], nation: string) => levelUps
  .flatMap(entry => buildingsUnlockedAt(entry.level))
  .map(type => ({ label: getNationBuildingDefinition(type, nation).name, type }));

/** The celebration, the tutorial chapter the level opens and, when there are any, the new buildings. */
const getLevelUpMessage = (level: number, unlocked: number, i18n?: I18n) => {
  const chapter = homeChapterName(level, i18n);
  const parts = [translateMessage(i18n, M.popup.levelMessage)];
  if (chapter) parts.push(translateMessage(i18n, M.popup.levelChapter, { chapter }));
  if (unlocked) parts.push(translateMessage(i18n, M.popup.levelBuildings));
  return parts.join(" ");
};

/** Close, led by Build (opens the picker on the new buildings) when the levels unlocked any. */
export const getLevelUpActions = (
  types: readonly number[], onBuild?: OpenBuildMenu, i18n?: I18n
): SettlementPopupAction[] => {
  const close = { label: translateMessage(i18n, M.popup.close) };
  if (!types.length || !onBuild) return [{ ...close, primary: true }];
  return [{ icon: "build", label: translateMessage(i18n, M.popup.build), primary: true,
    onSelect: () => onBuild(types) }, close];
};

/**
 * One popup for every level crossed at once; coins went to the headquarters, gems to the player. It
 * lists the buildings the new levels unlock.
 */
export const levelUpPopup = (
  levelUps: readonly LevelUp[], nation = "roman", onBuild?: OpenBuildMenu, i18n?: I18n
): SettlementPopupContent => {
  const level = levelUps.at(-1)!.level;
  const coins = levelUps.reduce((sum, entry) => sum + entry.coins, 0);
  const gems = levelUps.reduce((sum, entry) => sum + entry.gems, 0);
  const buildings = getUnlockedBuildings(levelUps, nation);
  return {
    actions: getLevelUpActions(buildings.map(building => building.type), onBuild, i18n),
    art: imageArt(progressionIcon(gems ? "gem" : "level-star")),
    buildings,
    message: getLevelUpMessage(level, buildings.length, i18n),
    rewards: { entries: [{ amount: coins, kind: "coins" }, { amount: gems, kind: "gems" }] },
    title: translateMessage(i18n, M.popup.level, { level }),
    tone: "victory"
  };
};
