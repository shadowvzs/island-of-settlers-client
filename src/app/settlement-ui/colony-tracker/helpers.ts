import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { isAdventureIsland } from "../../../shared/settlement/adventure-rules";
import { COLONY_TROOP_TYPES } from "../../../shared/settlement/colony-expedition-rules";
import type { MilitaryTroopType } from "../../../shared/settlement/military-combat-rules";
import type { ColonyExpeditionSnapshot } from "../../../shared/settlement/settlement-colony-expeditions";
import type { CommanderSnapshot } from "../../../shared/settlement/settlement-commander";
import { troopPortrait } from "../../settlement/army-icons";
import { troopPluralName } from "../../settlement/troop-names";
import { expeditionArt, settlementIconArt } from "../art-helpers";
import { colonyStatusLabel, formatColonyDuration, getColonyDifficultyName } from "../colony-helpers";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementAdventureSummary, SettlementColonySummary, SettlementUiSnapshot } from "../types";

const EMPTY_ADVENTURES: readonly SettlementAdventureSummary[] = [];
const EMPTY_COLONIES: readonly SettlementColonySummary[] = [];
const EMPTY_COMMANDERS: readonly CommanderSnapshot[] = [];
const EMPTY_EXPEDITIONS: readonly ColonyExpeditionSnapshot[] = [];

/** What the tracker reads from the settlement snapshot (shallow-compared). */
export const selectColonyTracker = (snapshot: SettlementUiSnapshot) => ({
  active: snapshot.activeColony ?? null,
  adventures: snapshot.adventures ?? EMPTY_ADVENTURES,
  colonies: snapshot.colonies ?? EMPTY_COLONIES,
  commanders: snapshot.commanders ?? EMPTY_COMMANDERS,
  expeditions: snapshot.colonyExpeditions ?? EMPTY_EXPEDITIONS,
  nation: snapshot.playerNation ?? "roman"
});

export type ColonyTrackerSlice = ReturnType<typeof selectColonyTracker>;

/** Landed expeditions are listed as colonies or adventures once their record exists. */
export const getPendingExpeditions = ({ adventures, colonies, expeditions }: ColonyTrackerSlice) => {
  const listed = new Set([...colonies, ...adventures].map(record => record.id));
  return expeditions.filter(expedition => !listed.has(expedition.id));
};

/** The tracker shows while an expedition is under way or a colony / adventure (or the way home) is listed. */
export const hasColonyTrackerContent = (snapshot: SettlementUiSnapshot, canReturnHome: boolean) => {
  const slice = selectColonyTracker(snapshot);
  if (slice.colonies.length || slice.adventures.length || getPendingExpeditions(slice).length) return true;
  return slice.active !== null && canReturnHome;
};

/** Collapsed, only the handle stays: the name and how many islands it lists. */
export const getTrackerHeading = (collapsed: boolean, count: number, i18n?: I18n) => {
  if (!collapsed) {
    return {
      expanded: true,
      heading: translateMessage(i18n, M.colony.trackerHeading),
      icon: "collapse",
      toggle: translateMessage(i18n, M.colony.trackerMinimise)
    };
  }
  return {
    expanded: false,
    heading: translateMessage(i18n, M.colony.trackerHeadingCount, { count }),
    icon: "expand",
    toggle: translateMessage(i18n, M.colony.trackerShow)
  };
};

/** Ordinary types first; a historical expedition may still show its saved cavalry badge. */
const TROOP_DISPLAY_ORDER: readonly MilitaryTroopType[] = [...COLONY_TROOP_TYPES, "cavalry"];
const getTroopBadges = (expedition: ColonyExpeditionSnapshot, nation: string) => TROOP_DISPLAY_ORDER
  .filter(type => expedition.troops[type])
  .map(type => ({
    count: expedition.troops[type],
    icon: troopPortrait(nation, type),
    title: `${troopPluralName(nation, type)}: ${expedition.troops[type]}`,
    type
  }));

const getSupplies = (expedition: ColonyExpeditionSnapshot, i18n?: I18n) => {
  if (expedition.status === "sailing" || isAdventureIsland(expedition.island)) return undefined;
  if (expedition.status === "arrived")
    return { goods: expedition.landed, heading: translateMessage(i18n, M.colony.landedSupplies) };
  return { goods: expedition.cargo, heading: translateMessage(i18n, M.colony.suppliesHeld) };
};

/** The open card's details: troops, supplies held or landed, and the cancel action while preparing. */
const getCardDetails = (
  expedition: ColonyExpeditionSnapshot, nation: string, canCancel: boolean, i18n?: I18n
) => {
  const colony = !isAdventureIsland(expedition.island);
  const commander = expedition.commander;
  return {
    cancel: canCancel && (expedition.status === "preparing" ||
      (expedition.status === "sailing" && expedition.departed === 0)),
    commander: commander ? translateMessage(i18n, M.colony.commanderVoyage, {
      hp: String(Math.ceil(commander.hp)), level: String(commander.level),
      maximum: String(Math.ceil(commander.maximumHp)), name: commander.name,
      slots: String(commander.deckSlots), xp: String(commander.xp)
    }) : "",
    note: colony && expedition.status === "arrived" ? translateMessage(i18n, M.colony.arrivedNote) : "",
    supplies: getSupplies(expedition, i18n),
    troops: getTroopBadges(expedition, nation)
  };
};

/** One card per expedition under way: countdown and loads progress while sailing; details when opened. */
export const getExpeditionCard = (
  expedition: ColonyExpeditionSnapshot, nation: string, open: boolean, canCancel: boolean, i18n?: I18n
) => {
  const kind = translateMessage(i18n,
    isAdventureIsland(expedition.island) ? M.colony.adventureKind : M.colony.colonyKind);
  const sailing = expedition.status === "sailing";
  return {
    art: expeditionArt(expedition.island, nation),
    className: expedition.status === "arrived" ? "colony-tracker__card is-arrived" : "colony-tracker__card",
    countdown: sailing && expedition.remainingSeconds !== null
      ? formatColonyDuration(expedition.remainingSeconds, i18n) : "",
    details: open ? getCardDetails(expedition, nation, canCancel, i18n) : undefined,
    id: expedition.id,
    label: translateMessage(i18n, M.colony.expeditionCardLabel, { id: expedition.id, kind }),
    progress: sailing ? { max: expedition.loads, value: expedition.arrived } : undefined,
    shipArt: settlementIconArt("ship", "colony-tracker__art"),
    status: colonyStatusLabel(expedition, i18n),
    title: translateMessage(i18n, M.colony.expeditionTitle, {
      difficulty: getColonyDifficultyName(expedition.island.difficulty, i18n),
      island: expedition.island.name, kind
    })
  };
};

export type ExpeditionCardView = ReturnType<typeof getExpeditionCard>;
