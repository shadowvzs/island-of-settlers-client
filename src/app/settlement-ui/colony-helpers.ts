import type { I18n } from "@lingui/core";
import { COLONY_LIFETIME_MS } from "@shared/catalog/balance";

import { COLONY_DIFFICULTIES } from "../../shared/balance/colonies";
import { translateMessage } from "../../shared/i18n/translate";
import {
  adventureEnemyCount, adventureEnemyPlan, type AdventureIsland,
isAdventureIsland} from "../../shared/settlement/adventure-rules";
import {
type ColonyDifficulty, type ColonyOre,   colonyTroopCount, type ColonyTroops
} from "../../shared/settlement/colony-expedition-rules";
import type { MilitaryTroopType } from "../../shared/settlement/military-combat-rules";
import type { ColonyExpeditionSnapshot } from "../../shared/settlement/settlement-colony-expeditions";
import { flagCodec } from "../preferences/codecs";
import { PREFERENCES } from "../preferences/keys";
import { definePreference } from "../preferences/registry";
import { SETTLEMENT_MESSAGES as M } from "./messages";
import type { SettlementAdventureSummary, SettlementColonySummary } from "./types";

/** The Colonies panel's minimal form is remembered for the browser session only (session scope). */
const coloniesCollapsed = definePreference(PREFERENCES.coloniesCollapsed, flagCodec(false));

/** A refused storage reads as expanded. */
export const readColoniesCollapsed = (storage?: Pick<Storage, "getItem">) => coloniesCollapsed.read(storage);

/** Private windows may refuse storage; the panel then simply opens expanded next time. */
export const storeColoniesCollapsed = (collapsed: boolean, storage?: Pick<Storage, "setItem">) => {
  coloniesCollapsed.write(collapsed, storage);
};

const DIFFICULTY_LABELS = {
  easy: M.colony.difficultyEasy, hard: M.colony.difficultyHard, medium: M.colony.difficultyMedium
} as const satisfies Readonly<Record<ColonyDifficulty, unknown>>;
const ORE_LABELS = {
  coal: M.colony.oreCoal, goldOre: M.colony.oreGold, ironOre: M.colony.oreIron, stone: M.colony.oreGranite
} as const satisfies Readonly<Record<ColonyOre, unknown>>;

export const getColonyDifficultyName = (difficulty: ColonyDifficulty, i18n?: I18n) =>
  translateMessage(i18n, DIFFICULTY_LABELS[difficulty]);
export const getColonyOreName = (ore: ColonyOre, i18n?: I18n) => translateMessage(i18n, ORE_LABELS[ore]);

export const formatColonyDuration = (seconds: number | null, i18n?: I18n) => {
  if (seconds === null || !Number.isFinite(seconds)) return "--:--";
  const total = Math.max(0, Math.ceil(seconds));
  if (total >= 86400)
    return translateMessage(i18n, M.colony.durationDays, {
      days: Math.floor(total / 86400), hours: Math.floor(total % 86400 / 3600)
    });
  if (total >= 3600)
    return translateMessage(i18n, M.colony.durationHours, {
      hours: Math.floor(total / 3600), minutes: Math.floor(total % 3600 / 60)
    });
  const minutes = Math.floor(total / 60), rest = total % 60;
  return translateMessage(i18n, M.colony.durationMinutes, {
    minutes, seconds: String(rest).padStart(2, "0")
  });
};

export const colonyDifficultySummary = (difficulty: ColonyDifficulty, i18n?: I18n) => {
  const rule = COLONY_DIFFICULTIES[difficulty];
  return translateMessage(i18n, M.colony.difficultySummary, {
    cap: rule.troopCap, forts: rule.enemyBuildings, troops: rule.enemyTroops
  });
};

/** Keeps one troop type inside both its stored count and the difficulty's remaining capacity. */
export const clampColonyTroop = (
  troops: Readonly<ColonyTroops>, type: MilitaryTroopType, wanted: number,
  difficulty: ColonyDifficulty, available: Readonly<Partial<ColonyTroops>>
) => {
  const others = colonyTroopCount(troops) - troops[type];
  const room = COLONY_DIFFICULTIES[difficulty].troopCap - others;
  const whole = Number.isFinite(wanted) ? Math.floor(wanted) : 0;
  return Math.max(0, Math.min(whole, room, available[type] ?? 0));
};

/** Shrinks a plan after a difficulty change lowers the cap, removing the last types first. */
export const fitColonyTroops = (troops: Readonly<ColonyTroops>, difficulty: ColonyDifficulty) => {
  const fitted = { ...troops };
  let excess = colonyTroopCount(fitted) - COLONY_DIFFICULTIES[difficulty].troopCap;
  for (const type of ["cavalry", "archer", "heavy", "shield"] as const) {
    if (excess <= 0) break;
    const removed = Math.min(excess, fitted[type]);
    fitted[type] -= removed;
    excess -= removed;
  }
  return fitted;
};

const preparingLabel = (expedition: ColonyExpeditionSnapshot, i18n?: I18n) => {
  if (!expedition.suppliesReady) return translateMessage(i18n, M.colony.statusCollecting);
  if (!expedition.crewReady) return translateMessage(i18n, isAdventureIsland(expedition.island)
    ? M.colony.statusTroopsWalking : M.colony.statusCrewWalking);
  return translateMessage(i18n, M.colony.statusWaitingShips);
};

export const colonyStatusLabel = (expedition: ColonyExpeditionSnapshot, i18n?: I18n) => {
  if (expedition.status === "preparing") return preparingLabel(expedition, i18n);
  const adventure = isAdventureIsland(expedition.island);
  const target = translateMessage(i18n, adventure ? M.colony.adventureKind : M.colony.colonyKind).toLowerCase();
  if (expedition.status === "arrived") {
    const ready = translateMessage(i18n,
      adventure ? M.colony.statusReadyAdventure : M.colony.statusReadyColony);
    return expedition.returningShips
      ? translateMessage(i18n, M.colony.statusReadyReturning, { ready, target }) : ready;
  }
  if (expedition.departed < expedition.loads)
    return translateMessage(i18n, M.colony.statusLoading, {
      departed: expedition.departed, loads: expedition.loads
    });
  return translateMessage(i18n, M.colony.statusSailing, {
    arrived: expedition.arrived, loads: expedition.loads, target
  });
};

/** All colony lifetimes use the same duration scale, including normal-length debug colonies. */
const colonyTimeLeft = (colony: SettlementColonySummary, now: number, i18n?: I18n) => {
  const left = (colony.conqueredAt ?? now) + COLONY_LIFETIME_MS - now;
  return `${formatColonyDuration(left / 1000, i18n)}${colony.island.debug
    ? translateMessage(i18n, M.colony.recordTest) : ""}`;
};

export const colonyRecordLabel = (colony: SettlementColonySummary, now: number, i18n?: I18n) => {
  if (colony.status === "landed") return translateMessage(i18n, M.colony.recordReady);
  if (colony.status === "contested") return translateMessage(i18n, M.colony.recordFighting);
  if (colony.status === "defeated") return translateMessage(i18n, M.colony.recordDefeated);
  return translateMessage(i18n, M.colony.recordConquered, {
    time: colonyTimeLeft(colony, now, i18n)
  });
};

/** Field camps, soldiers, map size and troop cap of an adventure (no enemy buildings). */
export const adventureThreatSummary = (island: AdventureIsland, i18n?: I18n) => {
  const plan = adventureEnemyPlan(island.difficulty);
  return translateMessage(i18n, M.colony.adventureThreat, {
    camps: plan.camps.length,
    cap: COLONY_DIFFICULTIES[island.difficulty].troopCap,
    difficulty: getColonyDifficultyName(island.difficulty, i18n),
    size: island.size,
    soldiers: adventureEnemyCount(island.difficulty)
  });
};

const ADVENTURE_LABELS = {
  contested: M.colony.adventureContested,
  defeated: M.colony.adventureDefeated,
  landed: M.colony.adventureLanded,
  won: M.colony.adventureWon
} as const satisfies Readonly<Record<SettlementAdventureSummary["status"], unknown>>;
export const adventureRecordLabel = (adventure: SettlementAdventureSummary, i18n?: I18n) =>
  translateMessage(i18n, ADVENTURE_LABELS[adventure.status]);
