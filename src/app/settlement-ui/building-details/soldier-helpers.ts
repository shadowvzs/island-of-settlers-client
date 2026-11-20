import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { MAX_SOLDIER_RANK } from "../../../shared/settlement/settlement-military-ranks";
import { troopPortrait, troopTypes } from "../../settlement/army-icons";
import { troopName, troopPluralName } from "../../settlement/troop-names";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementSoldierDetails } from "../types";

const RANK_MESSAGES = [
  M.details.soldiers.rankRecruit, M.details.soldiers.rankSoldier, M.details.soldiers.rankVeteran
] as const;

/** Readable rank name shared by the garrison summary, detail rows and stored groups. */
export const soldierRankName = (rank: number, i18n?: I18n) =>
  translateMessage(i18n, RANK_MESSAGES[Math.min(Math.max(0, Math.trunc(rank)), RANK_MESSAGES.length - 1)]!);

const PHASES = {
  assigned: M.details.soldiers.phaseAssigned,
  enterAssigned: M.details.soldiers.phaseEnterAssigned,
  enterRetire: M.details.soldiers.phaseEnterRetire,
  garrison: M.details.soldiers.phaseGarrison,
  militaryField: M.details.soldiers.phaseField,
  militaryLeaving: M.details.soldiers.phaseLeaving,
  militaryReserve: M.details.soldiers.phaseReserve,
  militarySiege: M.details.soldiers.phaseSiege,
  militaryTransferLeaving: M.details.soldiers.phaseTransfer,
  retire: M.details.soldiers.phaseRetire
} as const;

const RANKS = Array.from({ length: MAX_SOLDIER_RANK + 1 }, (_, rank) => rank);
const RANK_BADGES = ["I", "II", "III"] as const;

const getPhase = (phase: string, i18n?: I18n) =>
  translateMessage(i18n, PHASES[phase as keyof typeof PHASES] ?? M.details.soldiers.phaseTravelling);

/** One soldier's fixed type, rank, current/maximum HP and physical status. */
export const getSoldierDetail = (soldier: SettlementSoldierDetails, nation: string, i18n?: I18n) =>
  translateMessage(i18n, M.details.soldiers.row, {
    health: soldier.health,
    maximum: soldier.maximumHealth,
    number: soldier.actor + 1,
    phase: getPhase(soldier.phase, i18n),
    rank: soldierRankName(soldier.rank, i18n),
    troop: troopName(nation, soldier.type, i18n)
  });

/** A read-only row of one assigned soldier; equipment is fixed at recruitment. */
export const getSoldierRow = (soldier: SettlementSoldierDetails, nation: string, i18n?: I18n) => ({
  actor: soldier.actor,
  detail: getSoldierDetail(soldier, nation, i18n),
  icon: troopPortrait(nation, soldier.type, soldier.rank),
  rank: soldier.rank,
  rankBadge: RANK_BADGES[soldier.rank] ?? String(soldier.rank + 1),
  type: soldier.type
});

export type SoldierRow = ReturnType<typeof getSoldierRow>;

const getWoundedText = (
  wounded: number, health: number, maximum: number, i18n?: I18n
) => wounded > 0
  ? translateMessage(i18n, M.details.soldiers.wounded, { count: wounded, health, maximum })
  : "";

/** Only physical reserves belong to the focused storage; travelling/passenger soldiers do not. */
const storedSoldiers = (soldiers: readonly SettlementSoldierDetails[]) =>
  soldiers.filter(soldier => soldier.phase === "militaryReserve");

/**
 * Stored soldiers grouped by fixed troop type and rank, in roster order. The title lists every
 * individual soldier's current HP and status, so a mixed group never reads as fully healed.
 */
export const getSoldierGroups = (
  soldiers: readonly SettlementSoldierDetails[], nation: string, i18n?: I18n
) => {
  const stored = storedSoldiers(soldiers);
  return troopTypes.flatMap(type => RANKS.flatMap(rank => {
    const group = stored.filter(soldier => soldier.type === type && soldier.rank === rank);
    if (group.length === 0) return [];
    const wounded = group.filter(soldier => soldier.health < soldier.maximumHealth).length;
    const health = group.reduce((total, soldier) => total + soldier.health, 0);
    const maximum = group.reduce((total, soldier) => total + soldier.maximumHealth, 0);
    const rankName = soldierRankName(rank, i18n);
    const troop = group.length === 1
      ? troopName(nation, type, i18n) : troopPluralName(nation, type, i18n);
    const label = translateMessage(i18n, M.details.soldiers.groupLabel, { rank: rankName, troop });
    const groupTitle = translateMessage(i18n, M.details.soldiers.groupTitle, {
      count: group.length, label
    });
    const woundedText = getWoundedText(wounded, health, maximum, i18n);
    const title = [
      groupTitle, woundedText, ...group.map(soldier => getSoldierDetail(soldier, nation, i18n))
    ].filter(Boolean).join("\n");
    return [{
      count: String(group.length),
      icon: troopPortrait(nation, type, rank),
      key: `${type}-${rank}`,
      label,
      rank,
      rankBadge: RANK_BADGES[rank] ?? String(rank + 1),
      rankName,
      title,
      type,
      wounded,
      woundedText
    }];
  }));
};

export type SoldierGroup = ReturnType<typeof getSoldierGroups>[number];

/** The authoritative local stored total shown above the grouped cells. */
export const getStoredSoldierTotal = (soldiers: readonly SettlementSoldierDetails[], i18n?: I18n) =>
  translateMessage(i18n, M.details.soldiers.storedTotal, { count: storedSoldiers(soldiers).length });
