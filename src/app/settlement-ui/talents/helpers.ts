import type { I18n } from "@lingui/core";
import {
  CAPSTONE_BRANCH_POINTS, TALENT_BRANCHES, TALENT_MAX_RANK, TALENT_RESET_GEMS, type TalentBranch,
  type TalentDefinition, TALENTS, TIER_GATE_POINTS
} from "@shared/catalog/balance";

import { translateMessage } from "../../../shared/i18n/translate";
import {
  branchGatePoints, isCapstoneOpen, isTierOpen, rankOf, spentTalentPoints, talentPointsForLevel, talentRaiseCheck,
  type TalentRanks, tierPoints
} from "../../../shared/progression/talents";
import type { TooltipLine } from "../../components/info-tooltip-helpers";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementUiOptions, SettlementUiSnapshot } from "../types";
import { getTalentIcon, type TalentIcon } from "./talent-icons";
import { BRANCH_LABELS, formatAffects, formatEffects, talentName } from "./talent-text";

export const getTalentApplySuccess = (i18n?: I18n) => translateMessage(i18n, M.talents.applySuccess);
const EMPTY_RANKS: TalentRanks = Object.freeze({});

/** What the window depends on: level (points, gates), gems (reset), nation (icons) and applied ranks. */
export const selectTalentPlayer = ({ player }: SettlementUiSnapshot) => ({
  gems: player?.gems ?? 0,
  level: player?.level ?? 1,
  nation: player?.nation ?? "roman",
  talents: player?.talents ?? EMPTY_RANKS
});
export type TalentPlayer = ReturnType<typeof selectTalentPlayer>;

/** Points placed since the last Apply, and the paid reset's confirm step, for one opening of the window. */
export interface TalentDraft {
  confirmingReset: boolean;
  opened: number;
  points: TalentRanks;
}
export const emptyTalentDraft = (opened: number): TalentDraft =>
  ({ confirmingReset: false, opened, points: EMPTY_RANKS });
/** A draft from an earlier opening is discarded: a closed window reopens showing the applied ranks. */
export const currentTalentDraft = (draft: TalentDraft, opened: number) =>
  draft.opened === opened ? draft : emptyTalentDraft(opened);

/** The pending tree: applied ranks plus points placed since the last Apply. */
export const mergeTalentDraft = (applied: TalentRanks, draft: TalentRanks): TalentRanks => {
  const merged: Record<string, number> = { ...applied };
  for (const [id, rank] of Object.entries(draft)) merged[id] = Math.max(rankOf(applied, id), rank);
  return merged;
};

/** Why a card is locked (level, tier rule or capstone gate), with the player's progress towards it. */
const lockReason = (
  definition: TalentDefinition, ranks: TalentRanks, level: number, i18n?: I18n
) => {
  if (level < definition.requiredLevel)
    return translateMessage(i18n, M.talents.requiresLevel, {
      level: definition.requiredLevel, levelNow: level
    });
  const branch = translateMessage(i18n, BRANCH_LABELS[definition.branch]);
  if (!isTierOpen(ranks, definition)) {
    const tier = definition.tier - 1, spent = tierPoints(ranks, definition.branch, tier);
    return translateMessage(i18n, M.talents.requiresTier, {
      branch, placed: spent, points: TIER_GATE_POINTS, tier
    });
  }
  if (!isCapstoneOpen(ranks, definition)) {
    const spent = branchGatePoints(ranks, definition.branch);
    return translateMessage(i18n, M.talents.requiresBranch, {
      branch, placed: spent, points: CAPSTONE_BRANCH_POINTS
    });
  }
  return undefined;
};

/** The badge on a locked card: the level it needs, or the points its tier or capstone gate still needs. */
const lockBadge = (definition: TalentDefinition, level: number, i18n?: I18n) => {
  if (level < definition.requiredLevel)
    return translateMessage(i18n, M.common.levelBadge, { level: definition.requiredLevel });
  return translateMessage(i18n, M.talents.pointsBadge, {
    points: definition.capstone ? CAPSTONE_BRANCH_POINTS : TIER_GATE_POINTS
  });
};

/** Current effect (once ranked), the next rank's effect (below the highest), what it affects and any lock. */
const tooltipLines = (
  definition: TalentDefinition, rank: number, lock: string | undefined, nation: string, i18n?: I18n
) => {
  const lines: TooltipLine[] = [];
  if (rank > 0)
    lines.push({ text: translateMessage(i18n, M.talents.now, {
      effects: formatEffects(definition, rank, i18n), rank
    }) });
  if (rank < TALENT_MAX_RANK)
    lines.push({ text: translateMessage(i18n, M.talents.nextRank, {
      effects: formatEffects(definition, rank + 1, i18n), rank: rank + 1
    }) });
  lines.push({ text: translateMessage(i18n, M.talents.affects, {
    affects: formatAffects(definition, nation, i18n)
  }) });
  if (lock) lines.push({ marked: true, text: lock });
  return lines;
};

const cardClassName = (locked: boolean, pending: boolean, maxed: boolean) => [
  "talents__card",
  locked ? "talents__card--locked" : "",
  pending ? "talents__card--pending" : "",
  maxed ? "talents__card--maxed" : ""
].filter(Boolean).join(" ");

interface CardContext {
  applied: TalentRanks; draft: TalentRanks; i18n?: I18n; level: number; nation: string;
}

const getTalentCard = (
  definition: TalentDefinition, { applied, draft, i18n, level, nation }: CardContext
) => {
  const rank = rankOf(draft, definition.id), name = talentName(definition.id, i18n);
  const lock = lockReason(definition, draft, level, i18n);
  const pending = rank > rankOf(applied, definition.id);
  const maxed = rank >= TALENT_MAX_RANK;
  const icon: TalentIcon = getTalentIcon(definition.id, nation);
  return {
    actionLabel: translateMessage(i18n, M.talents.actionLabel, {
      action: lock ?? translateMessage(i18n, M.talents.addPoint),
      max: TALENT_MAX_RANK, name, rank
    }),
    canRaise: talentRaiseCheck(draft, definition.id, level) === true,
    className: cardClassName(Boolean(lock), pending, maxed),
    icon,
    id: definition.id,
    lockText: lock && lockBadge(definition, level, i18n),
    locked: Boolean(lock),
    name,
    rankText: `${rank}/${TALENT_MAX_RANK}`,
    tooltip: tooltipLines(definition, rank, lock, nation, i18n)
  };
};
export type TalentCard = ReturnType<typeof getTalentCard>;

const TIERS = [1, 2, 3, 4] as const;

const getBranchColumn = (branch: TalentBranch, context: CardContext) => {
  const talents = TALENTS.filter(entry => entry.branch === branch);
  return {
    branch,
    label: translateMessage(context.i18n, BRANCH_LABELS[branch]),
    tiers: TIERS.map(tier => ({
      cards: talents.filter(entry => entry.tier === tier).map(entry => getTalentCard(entry, context)),
      label: translateMessage(context.i18n, M.talents.tier, { tier }),
      tier
    }))
  };
};
export type TalentColumn = ReturnType<typeof getBranchColumn>;

const resetAction = (
  pendingPoints: number, appliedPoints: number, confirming: boolean, gems: number, i18n?: I18n
) => {
  if (pendingPoints > 0) return {
    disabled: false,
    label: translateMessage(i18n, M.talents.resetPending),
    title: translateMessage(i18n, M.talents.resetPendingTitle)
  };
  if (confirming) return {
    disabled: gems < TALENT_RESET_GEMS,
    label: translateMessage(i18n, M.talents.confirmReset, { gems: TALENT_RESET_GEMS }),
    title: translateMessage(i18n, M.talents.everyPointBack)
  };
  return {
    disabled: appliedPoints === 0,
    label: translateMessage(i18n, M.talents.resetAll, { gems: TALENT_RESET_GEMS }),
    title: translateMessage(i18n, M.talents.resetAllTitle, { gems: TALENT_RESET_GEMS })
  };
};

const applyLabel = (pendingPoints: number, i18n?: I18n) => {
  if (pendingPoints === 0) return translateMessage(i18n, M.talents.apply);
  return pendingPoints === 1
    ? translateMessage(i18n, M.talents.applyOne)
    : translateMessage(i18n, M.talents.applyMany, { count: pendingPoints });
};

/** The whole window's prepared view: three branch columns of tier rows, points and the two actions. */
export const getTalentWindowModel = (
  player: TalentPlayer, draft: TalentRanks, confirmingReset: boolean, i18n?: I18n
) => {
  const context = { applied: player.talents, draft, i18n, level: player.level, nation: player.nation };
  const total = talentPointsForLevel(player.level), placed = spentTalentPoints(draft);
  const appliedPoints = spentTalentPoints(player.talents), pendingPoints = placed - appliedPoints;
  return {
    applyDisabled: pendingPoints === 0,
    applyLabel: applyLabel(pendingPoints, i18n),
    columns: TALENT_BRANCHES.map(branch => getBranchColumn(branch, context)),
    pointsText: translateMessage(i18n, M.talents.points, { placed, total }),
    reset: resetAction(pendingPoints, appliedPoints, confirmingReset, player.gems, i18n),
    pendingPoints
  };
};
export type TalentWindowModel = ReturnType<typeof getTalentWindowModel>;

/** The talents command callbacks: true, or why they were refused. */
export const applyTalentDraft = (
  { onApplyTalents }: Pick<SettlementUiOptions, "onApplyTalents">, ranks: TalentRanks, i18n?: I18n
) => onApplyTalents?.(ranks) ?? translateMessage(i18n, M.talents.unavailable);
export const resetAppliedTalentTree = (
  { onResetTalents }: Pick<SettlementUiOptions, "onResetTalents">, i18n?: I18n
) => onResetTalents?.() ?? translateMessage(i18n, M.talents.unavailable);

