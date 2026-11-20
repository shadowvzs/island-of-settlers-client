import type {
  CampaignMapRewards, CampaignRewardSoldier, CampaignSoldierAmount, CampaignWareAmount
} from "../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { MilitaryTroopType } from "../../../shared/settlement/military-combat-rules";
import { getSettlementInventoryEntries } from "../inventory";
import { COIN_WARE } from "./constants";

/**
 * Every reward kind a reward display can show (React-free, so popup content built at startup stays light).
 * Soldier ranks are 0-based; a building unlock has no amount.
 */
export type RewardEntry =
  | { amount: number; kind: "coins" }
  | { amount: number; kind: "gems" }
  | { amount: number; item: string; kind: "decoration" }
  | { amount: number; kind: "settlers" }
  | { amount: number; kind: "soldier"; rank?: number; soldierType: MilitaryTroopType }
  | { amount: number; kind: "ware"; ware: string }
  | { amount: number; kind: "xp" }
  | { buildingType: number; kind: "buildingUnlock" };

export type RewardEntryKind = RewardEntry["kind"];

const wareEntry = (ware: string, amount: number): RewardEntry =>
  ware === COIN_WARE ? { amount, kind: "coins" } : { amount, kind: "ware", ware };

/** What reward displays may name under the island's rules (plan §9.3, §9.2). */
export interface RewardDisplayRules {
  experienceRewarded: boolean;
  rewardsShown: boolean;
}

/** The entries a reward display shows: none with rewards off, no experience with experience off. */
export const displayedRewardEntries = (
  entries: readonly RewardEntry[], { experienceRewarded, rewardsShown }: RewardDisplayRules
): readonly RewardEntry[] => {
  if (!rewardsShown) return [];
  return experienceRewarded ? entries : entries.filter(entry => entry.kind !== "xp");
};

/** A goods record (coins included) in inventory order. */
export const goodsRewardEntries = (goods: Readonly<Record<string, number>>): RewardEntry[] =>
  getSettlementInventoryEntries(goods).map(({ count, ware }) => wareEntry(ware, count));

const wareAmountEntries = (goods: readonly CampaignWareAmount[]) =>
  goods.map(({ amount, ware }) => wareEntry(ware, amount));

const soldierEntries = (soldiers: readonly (CampaignRewardSoldier | CampaignSoldierAmount)[]): RewardEntry[] =>
  soldiers.map(line => "rank" in line && line.rank !== undefined
    ? { amount: line.amount, kind: "soldier", rank: line.rank, soldierType: line.type }
    : { amount: line.amount, kind: "soldier", soldierType: line.type });

const settlerEntries = (amount: number): RewardEntry[] => (amount > 0 ? [{ amount, kind: "settlers" }] : []);

/**
 * Campaign, quest-home and campaign map rewards: experience, coins, gems, goods, the map's soldiers and settlers
 * (absent on campaign and quest rewards), then decorations.
 */
export const campaignRewardEntries = (rewards: CampaignMapRewards): RewardEntry[] => [
  { amount: rewards.xp, kind: "xp" },
  { amount: rewards.coins, kind: "coins" },
  { amount: rewards.gems, kind: "gems" },
  ...wareAmountEntries(rewards.goods),
  ...soldierEntries(rewards.soldiers ?? []),
  ...settlerEntries(rewards.settlers ?? 0),
  ...rewards.decorations.map(({ amount, item }): RewardEntry => ({ amount, item, kind: "decoration" }))
];

/** A campaign quest's map reward: goods and soldiers delivered to the campaign harbour. */
export const campaignMapRewardEntries = (reward: {
  goods: readonly CampaignWareAmount[]; soldiers: readonly CampaignSoldierAmount[];
}): RewardEntry[] => [...wareAmountEntries(reward.goods), ...soldierEntries(reward.soldiers)];
