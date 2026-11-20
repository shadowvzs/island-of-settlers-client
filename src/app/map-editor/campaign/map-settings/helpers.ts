import {
  CAMPAIGN_LIMITS, CAMPAIGN_SOLDIER_TYPES
} from "../../../../../../island-of-settlers-shared/src/campaign/campaign-constants";
import type {
  CampaignCargo, CampaignMap, CampaignMapRewards, CampaignRewardSoldier, CampaignSoldierType
} from "../../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  type GameSettings, hasHomeIsland
} from "../../../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { mapRecordModeIssues } from "../../../../shared/campaign/game-mode/map-mode-checks";
import { isRewardKindPaid, type RewardScope, rewardScopeOf } from "../../../../shared/campaign/game-mode/reward-scope";
import {
  campaignMapRewardEntries, campaignRewardEntries, type RewardEntry
} from "../../../settlement-ui/reward-icons/entries";
import { COIN_WARE_ID } from "../../reward-picker/constants";
import { MAX_MINIMUM_LEVEL } from "../constants";
import { CARGO_SOLDIER_RANK } from "./constants";

/** The map's minimum player level (its `playerLevel` unlock condition), or 0 for none. */
export const minimumLevelOf = (map: CampaignMap) => {
  const condition = map.unlock.find(entry => entry.kind === "playerLevel");
  return condition?.kind === "playerLevel" ? condition.level : 0;
};

/** The map with its minimum level set (0 or less removes the condition); other unlock conditions stay. */
export const withMinimumLevel = (map: CampaignMap, level: number): CampaignMap => {
  const others = map.unlock.filter(entry => entry.kind !== "playerLevel");
  const clamped = Math.min(Math.floor(level), MAX_MINIMUM_LEVEL);
  if (!Number.isFinite(clamped) || clamped < 1) return { ...map, unlock: others };
  return { ...map, unlock: [...others, { kind: "playerLevel", level: clamped }] };
};

/** A whole, non-negative amount from a number input (blank or invalid: 0). */
export const toAmount = (value: string) => {
  const amount = Math.floor(Number(value));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

/** The map's rewards as picker lines (empty amounts left out; unknown decoration ids kept for the warning). */
export const mapRewardEntries = (rewards: CampaignMapRewards): RewardEntry[] =>
  campaignRewardEntries(rewards).filter(entry => !("amount" in entry) || entry.amount > 0);

const sumOf = (entries: readonly RewardEntry[], kind: "coins" | "gems" | "settlers" | "xp") =>
  entries.reduce((sum, entry) => sum + (entry.kind === kind ? entry.amount : 0), 0);

const isCampaignSoldierType = (type: string): type is CampaignSoldierType =>
  (CAMPAIGN_SOLDIER_TYPES as readonly string[]).includes(type);

const soldierLines = (entries: readonly RewardEntry[]): CampaignRewardSoldier[] => entries.flatMap(entry => {
  if (entry.kind !== "soldier" || !isCampaignSoldierType(entry.soldierType)) return [];
  const line: CampaignRewardSoldier = { amount: entry.amount, type: entry.soldierType };
  return entry.rank === undefined ? [line] : [{ ...line, rank: entry.rank }];
});

/**
 * The map rewards the picker lines describe; kinds the map model cannot hold (building unlocks) are dropped.
 * Soldiers and settlers are omitted when empty, so maps without them keep their stored shape.
 */
export const withRewardEntries = (rewards: CampaignMapRewards, entries: readonly RewardEntry[]): CampaignMapRewards => {
  const { settlers: _settlers, soldiers: _soldiers, ...shared } = rewards;
  const soldiers = soldierLines(entries), settlers = sumOf(entries, "settlers");
  return {
    ...shared,
    coins: sumOf(entries, "coins"),
    decorations: entries.flatMap(entry => (entry.kind === "decoration" ? [{ amount: entry.amount, item: entry.item }]
      : [])),
    gems: sumOf(entries, "gems"),
    goods: entries.flatMap(entry => (entry.kind === "ware" ? [{ amount: entry.amount, ware: entry.ware }] : [])),
    xp: sumOf(entries, "xp"),
    ...(settlers > 0 ? { settlers } : {}),
    ...(soldiers.length ? { soldiers } : {})
  };
};

/**
 * The map's reward lines by the game's reward scope (owner Q2, plan §9.3): `shown` are edited, `hidden` are the
 * stored lines the mode does not pay (kept untouched, empty amounts included, so a mode switch loses nothing).
 */
export const scopedRewardEntries = (rewards: CampaignMapRewards, scope: RewardScope) => {
  const isPaid = (entry: RewardEntry) => isRewardKindPaid(scope, entry.kind);
  return {
    hidden: campaignRewardEntries(rewards).filter(entry => !isPaid(entry)),
    shown: mapRewardEntries(rewards).filter(isPaid)
  };
};

/** The rewards after an edit of the shown lines: the lines hidden by the scope keep their stored values. */
export const withScopedRewardEntries = (
  rewards: CampaignMapRewards, shown: readonly RewardEntry[], scope: RewardScope
): CampaignMapRewards => withRewardEntries(rewards, [...scopedRewardEntries(rewards, scope).hidden, ...shown]);

/** The required cargo as picker lines: goods, soldiers by type (shown as the base recruit) and settlers. */
export const cargoEntries = (cargo: CampaignCargo): RewardEntry[] => [
  ...campaignMapRewardEntries(cargo).map((entry): RewardEntry =>
    (entry.kind === "soldier" ? { ...entry, rank: CARGO_SOLDIER_RANK } : entry)),
  ...(cargo.settlers > 0 ? [{ amount: cargo.settlers, kind: "settlers" as const }] : [])
].filter(entry => !("amount" in entry) || entry.amount > 0);

/** The picker lines back as cargo; kinds a cargo cannot hold are dropped. */
export const cargoFromEntries = (entries: readonly RewardEntry[]): CampaignCargo => ({
  goods: entries.flatMap(entry => {
    if (entry.kind === "ware") return [{ amount: entry.amount, ware: entry.ware }];
    return entry.kind === "coins" ? [{ amount: entry.amount, ware: COIN_WARE_ID }] : [];
  }),
  settlers: sumOf(entries, "settlers"),
  soldiers: entries.flatMap(entry => (entry.kind === "soldier" && isCampaignSoldierType(entry.soldierType)
    ? [{ amount: entry.amount, type: entry.soldierType }] : []))
});

/** The map with its soldier cap set from a number input (0: no cap). */
export const withSoldierCap = (map: CampaignMap, value: string): CampaignMap =>
  ({ ...map, soldierCap: Math.min(toAmount(value), CAMPAIGN_LIMITS.maxCount) });

/** The record's mode warnings grouped by code (several ignored unlock conditions make one line). */
export const mapModeWarnings = (map: CampaignMap, settings: GameSettings) => {
  const counts = new Map<string, number>();
  for (const { code } of mapRecordModeIssues(map, settings)) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...counts].map(([code, count]) => ({ code, count }));
};

/**
 * What the selected map shows under the deployment's game mode: the reward lines the mode pays, how many stored
 * lines it hides, the launch cargo (only with a home island; hidden without one and kept) and the mode warnings.
 */
export const mapModeView = (map: CampaignMap, settings: GameSettings) => {
  const scope = rewardScopeOf(settings);
  const { hidden, shown } = scopedRewardEntries(map.rewards, scope);
  return {
    hiddenRewards: hidden.filter(entry => "amount" in entry && entry.amount > 0).length,
    launchCargo: hasHomeIsland(settings) ? cargoEntries(map.requiredCargo) : null,
    rewards: shown,
    scope,
    warnings: mapModeWarnings(map, settings)
  };
};
