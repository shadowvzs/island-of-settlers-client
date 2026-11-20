import type { I18n } from "@lingui/core";
import { COLONY_LIFETIME_MS } from "@shared/catalog/balance";

import { translateMessage } from "../../shared/i18n/translate";
import type { AdventureIsland } from "../../shared/settlement/adventure-rules";
import { colonyOreShipMs } from "../../shared/settlement/archipelago";
import type { ColonyIsland } from "../../shared/settlement/colony-expedition-rules";
import { adventureArt, imageArt, wareArt } from "./art-helpers";
import { getColonyOreName } from "./colony-helpers";
import { SETTLEMENT_MESSAGES as M } from "./messages";
import { victoryEmblem } from "./player-hud-helpers";
import { goodsRewardEntries } from "./reward-icons/entries";
import type { SettlementPopupContent } from "./settlement-popup";
import type { SettlementAdventureReward } from "./types";

/** The nation's crossed weapons, shield and ornaments, shown large on every won battle. */
const victoryEmblemArt = (nation: string) => imageArt(victoryEmblem(nation), "settlement-popup__emblem");

const DURATION_UNITS = [
  { key: "day", ms: 86_400_000 }, { key: "hour", ms: 3_600_000 },
  { key: "minute", ms: 60_000 }, { key: "second", ms: 1000 }
] as const;

const DURATION_LABELS = {
  day: { many: M.colony.durationDayMany, one: M.colony.durationDayOne },
  hour: { many: M.colony.durationHourMany, one: M.colony.durationHourOne },
  minute: { many: M.colony.durationMinuteMany, one: M.colony.durationMinuteOne },
  second: { many: M.colony.durationSecondMany, one: M.colony.durationSecondOne }
} as const;

/** "1 hour", "14 days", "20 seconds": the largest whole unit, so test colonies read their short timers. */
const describeDuration = (ms: number, i18n?: I18n) => {
  const unit = DURATION_UNITS.find(candidate => ms >= candidate.ms && ms % candidate.ms === 0) ?? DURATION_UNITS[3];
  const count = Math.round(ms / unit.ms);
  return translateMessage(i18n,
    count === 1 ? DURATION_LABELS[unit.key].one : DURATION_LABELS[unit.key].many, { count });
};

const EVERY_LABELS = {
  day: M.colony.durationEveryDay, hour: M.colony.durationEveryHour,
  minute: M.colony.durationEveryMinute, second: M.colony.durationEverySecond
} as const;

const describeOreShips = (ms: number, i18n?: I18n) => {
  const unit = DURATION_UNITS.find(candidate => ms >= candidate.ms && ms % candidate.ms === 0)
    ?? DURATION_UNITS[3];
  if (Math.round(ms / unit.ms) === 1) return translateMessage(i18n, EVERY_LABELS[unit.key]);
  return translateMessage(i18n, M.colony.durationEvery, { interval: describeDuration(ms, i18n) });
};

interface ColonyOutcomeActions {
  /** Experience paid for the conquest, shown like an adventure's reward. */
  experience?: number;
  /** The colony resource ship talent's share off the interval (the rule's `colonyOreShipMs`). */
  oreShipReduction?: number;
  onDisband?: () => void;
  onReturnHome?: () => void;
}

const conquestMessage = (island: ColonyIsland, oreShipReduction: number, i18n?: I18n) =>
  translateMessage(i18n, M.colony.popupConquered, {
    interval: describeOreShips(colonyOreShipMs(oreShipReduction), i18n),
    island: island.name,
    lifetime: describeDuration(COLONY_LIFETIME_MS, i18n),
    ore: getColonyOreName(island.ore, i18n).toLowerCase(),
    talent: oreShipReduction > 0
      ? translateMessage(i18n, M.common.talentReduction, { percent: Math.round(oreShipReduction * 100) }) : ""
  });

/** Popup for the moment a colony's fate is decided. */
export const colonyOutcomePopup = (
  status: "conquered" | "defeated", island: ColonyIsland, nation: string,
  { experience, onDisband, onReturnHome, oreShipReduction = 0 }: ColonyOutcomeActions = {}, i18n?: I18n
): SettlementPopupContent => {
  if (status === "conquered") return {
    actions: [
      { icon: "build", label: translateMessage(i18n, M.colony.popupStayBuild), primary: true },
      ...(onReturnHome ? [{ icon: "ship", label: translateMessage(i18n, M.colony.popupSailHome),
        onSelect: onReturnHome }] : [])
    ],
    art: victoryEmblemArt(nation),
    fanfare: true,
    message: conquestMessage(island, oreShipReduction, i18n),
    rewards: experience ? { entries: [{ amount: experience, kind: "xp" }] } : undefined,
    title: translateMessage(i18n, M.colony.popupConqueredTitle),
    tone: "victory"
  };
  return {
    actions: [
      ...(onDisband ? [{ icon: "cancel", label: translateMessage(i18n, M.colony.popupDisband),
        onSelect: onDisband, primary: true }] : []),
      { icon: "ship", label: translateMessage(i18n, M.colony.popupStay) }
    ],
    art: wareArt(island.ore),
    message: translateMessage(i18n, M.colony.popupDefeated, { island: island.name }),
    title: translateMessage(i18n, M.colony.popupFailedTitle),
    tone: "defeat"
  };
};

/** Popup for a won or lost adventure; either way the survivors sail home and the island is discarded. */
export const adventureOutcomePopup = (
  status: "won" | "defeated", island: AdventureIsland, nation: string,
  reward?: SettlementAdventureReward, onReturnHome?: () => void, i18n?: I18n
): SettlementPopupContent => {
  const actions = [
    { icon: "sailBack", iconOnly: true, label: translateMessage(i18n, M.colony.popupSailHome),
      onSelect: onReturnHome, primary: true }
  ];
  if (status === "won") return {
    actions,
    art: victoryEmblemArt(nation),
    fanfare: true,
    message: translateMessage(i18n, M.colony.popupAdventureWon, { island: island.name }),
    rewards: {
      entries: [{ amount: reward?.experience ?? 0, kind: "xp" }, ...goodsRewardEntries(reward?.goods ?? {})]
    },
    title: translateMessage(i18n, M.colony.popupAdventureWonTitle),
    tone: "victory"
  };
  return {
    actions,
    art: adventureArt(nation),
    message: translateMessage(i18n, M.colony.popupAdventureDefeated, { island: island.name }),
    title: translateMessage(i18n, M.colony.popupAdventureFailedTitle),
    tone: "defeat"
  };
};
