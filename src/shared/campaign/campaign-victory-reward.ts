import type { CampaignRewardSoldier } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import {
type CampaignVictoryKind,   campaignVictoryKind, type CampaignVictoryPayout, victoryDayKey
} from "../../../../island-of-settlers-shared/src/campaign/campaign-victory-reward";
import { isPlainObject } from "../../../../island-of-settlers-shared/src/validation/index";
import { militaryHealth } from "../settlement/military-combat-rules";
import type { EmigratedTroop } from "../settlement/settlement-military";
import type { Goods } from "../settlement/settlement-types";

/**
 * A guest's campaign victory rewards (C12): without a server the account's first completions and the day of each
 * map's last paid replay live in the player progress, so the shared payout rule (first / replay third / daily cap)
 * applies offline too. Signed-in players use the server's claim instead.
 */
export interface LocalCampaignVictories {
  /** Map ids whose first completion was paid. */
  completed: string[];
  /** Map id → UTC day (`YYYY-MM-DD`) of its last paid replay reward. */
  replayDays: Record<string, string>;
}

/** What sails home on the reward ship: goods (coins included), settlers and soldiers (C12, owner 2026-11-11). */
export interface CampaignVictoryShipment {
  goods: Goods;
  settlers: number;
  soldiers: EmigratedTroop[];
}

const isStringList = (value: unknown) => Array.isArray(value) && value.every(entry => typeof entry === "string");

/** True when a stored value is valid local victory progress (or absent). */
export const validLocalCampaignVictories = (value: unknown) => value === undefined || (isPlainObject(value) &&
  isStringList(value.completed) && isPlainObject(value.replayDays) &&
  Object.values(value.replayDays).every(day => typeof day === "string"));

/** How a guest's victory on `mapId` at `now` (UTC ms) is paid. */
export const localVictoryKind = (
  victories: LocalCampaignVictories | undefined, mapId: string, now: number
): CampaignVictoryKind => campaignVictoryKind(Boolean(victories?.completed.includes(mapId)),
  victories?.replayDays[mapId] === victoryDayKey(now));

/** The local progress after a paid victory of `kind`. */
export const recordLocalVictory = (
  victories: LocalCampaignVictories | undefined, mapId: string, kind: CampaignVictoryKind, now: number
): LocalCampaignVictories => {
  const current = victories ?? { completed: [], replayDays: {} };
  if (kind === "first") return { ...current, completed: [...current.completed, mapId] };
  if (kind === "replay") return { ...current, replayDays: { ...current.replayDays, [mapId]: victoryDayKey(now) } };
  return current;
};

/** Reward soldier lines as troops; the rank is 0-based (absent: a recruit). */
export const rewardTroops = (lines: readonly CampaignRewardSoldier[]): EmigratedTroop[] =>
  lines.flatMap(({ amount, rank = 0, type }) =>
    Array.from({ length: amount }, () => ({ hp: militaryHealth(type, rank), rank, type })));

/** The part of a payout the reward ship carries. */
export const victoryShipment = (payout: CampaignVictoryPayout): CampaignVictoryShipment => ({
  goods: payout.coins > 0 ? { ...payout.goods, coins: payout.coins } : { ...payout.goods },
  settlers: payout.settlers,
  soldiers: rewardTroops(payout.soldiers)
});
