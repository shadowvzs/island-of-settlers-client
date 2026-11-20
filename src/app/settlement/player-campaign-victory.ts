import { createCampaignRewards } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import {
type CampaignVictoryPayout,
  campaignVictoryPayout, walletOnlyVictoryPayout} from "../../../../island-of-settlers-shared/src/campaign/campaign-victory-reward";
import { playerItemDefinition } from "../../../../island-of-settlers-shared/src/player-inventory";
import type { CampaignRunState } from "../../shared/campaign/campaign-run";
import {
  type CampaignVictoryShipment, localVictoryKind, recordLocalVictory, victoryShipment
} from "../../shared/campaign/campaign-victory-reward";
import type { PlayerProgress } from "../../shared/progression/player-progress";
import type { ServerEconomy } from "../cloud/server-economy";

/** Text of a signed-in run without a server attempt (offline or unknown campaign at departure): it pays nothing. */
export const UNTRACKED_VICTORY = "This campaign attempt was not tracked by the server, so it pays no reward";

interface PlayerCampaignVictoryOptions {
  commit(next: PlayerProgress): void;
  /** A signed-in player's server claim; absent for guests. */
  economy?: Pick<ServerEconomy, "claimCampaignVictory">;
  get(): PlayerProgress;
  /** XP of the reward, with its level-ups (on the campaign map their coins become home grants). */
  grantExperience(experience: number): void;
  /** Resolves a refusal in the interface language. */
  localize(text: string): string;
  now(): number;
  /** Rewards are on under the rules of the run's island (plan §9.3); off: the victory pays nothing. */
  rewardsOn?(): boolean;
  /** No home island: only the account wallet (gems, XP) is paid, nothing sails home. */
  walletOnly?(): boolean;
}

/** Decorations into the guest's personal inventory, each up to its hold limit (the rest is not credited). */
const withDecorations = (progress: PlayerProgress, decorations: Readonly<Record<string, number>>): PlayerProgress => {
  const inventory: Record<string, number | undefined> = { ...progress.inventory };
  for (const [item, amount] of Object.entries(decorations)) {
    const limit = playerItemDefinition(item)?.maxHeld ?? 0;
    const total = Math.min(limit, (inventory[item] ?? 0) + amount);
    if (total > 0) inventory[item] = total;
  }
  return { ...progress, inventory };
};

/**
 * The victory reward of a won campaign run (C12): the server's claim for a signed-in player, the shared rule over
 * the guest's local progress otherwise. Gems, decorations and XP are credited to the player directly; the answer is
 * what the reward ship carries home. A refusal comes back as its text; an unreachable server throws. With rewards
 * off nothing is claimed or paid (undefined: no reward ship), and the campaign still advances.
 */
export const createPlayerCampaignVictory = (options: PlayerCampaignVictoryOptions) => {
  const claimLocal = (run: CampaignRunState): CampaignVictoryShipment => {
    const now = options.now(), progress = options.get();
    const kind = localVictoryKind(progress.campaignVictories, run.mapId, now);
    const full = campaignVictoryPayout(run.rewards ?? createCampaignRewards(), kind);
    const payout = options.walletOnly?.() ? walletOnlyVictoryPayout(full) : full;
    const credited = withDecorations({ ...progress, gems: progress.gems + payout.gems }, payout.decorations);
    options.commit({ ...credited,
      campaignVictories: recordLocalVictory(progress.campaignVictories, run.mapId, kind, now) });
    return paid(payout, true);
  };
  const paid = (payout: CampaignVictoryPayout, fresh: boolean) => {
    if (fresh && payout.xp > 0) options.grantExperience(payout.xp);
    return victoryShipment(payout);
  };
  const claimServer = async (claim: NonNullable<ServerEconomy["claimCampaignVictory"]>, run: CampaignRunState) => {
    if (!run.attemptId) return options.localize(UNTRACKED_VICTORY);
    const answer = await claim(run.attemptId);
    if (typeof answer === "string") return options.localize(answer);
    const progress = options.get();
    options.commit({ ...progress, gems: answer.wallet.gems, inventory: answer.wallet.items ?? progress.inventory });
    // A repeat means an earlier session already credited the XP; its load never reached home, so it still sails.
    return paid(answer.payout, !answer.repeated);
  };
  return {
    claim: async (run: CampaignRunState): Promise<CampaignVictoryShipment | string | undefined> => {
      if (options.rewardsOn?.() === false) return undefined;
      const claim = options.economy?.claimCampaignVictory;
      return claim ? claimServer(claim, run) : claimLocal(run);
    }
  };
};
