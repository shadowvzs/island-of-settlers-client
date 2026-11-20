import { describe, expect, it, vi } from "vitest";

import type { CampaignMapRewards } from "../../island-of-settlers-shared/src/campaign/campaign-model";
import { createHomeClaimSubmitter } from "../src/app/settlement/home-claim-submitter";
import { createPlayerCampaignVictory } from "../src/app/settlement/player-campaign-victory";
import { campaignMapRows } from "../src/app/settlement-ui/campaign-window/helpers";
import type { CampaignChoice } from "../src/app/settlement-ui/campaign-window/types";
import { displayedRewardEntries, type RewardEntry } from "../src/app/settlement-ui/reward-icons/entries";
import { type CampaignRunState, createCampaignRunState } from "../src/shared/campaign/campaign-run";
import { createPlayerProgress, type PlayerProgress } from "../src/shared/progression/player-progress";

/** PROG (plan §9.3): with rewards off nothing is claimed, paid or shown; the campaign still advances. */

const REWARDS: CampaignMapRewards = { coins: 30, decorations: [], gems: 9, goods: [{ amount: 6, ware: "planks" }],
  settlers: 2, soldiers: [{ amount: 1, rank: 1, type: "archer" }], xp: 12 };
const wonRun = (): CampaignRunState => ({
  ...createCampaignRunState({ attempt: 1, campaignId: "isles", mapId: "bay" }, { rewards: REWARDS }), status: "won"
});

const guestVictory = (rules: { rewardsOn: boolean; walletOnly: boolean }) => {
  let progress: PlayerProgress = createPlayerProgress(1);
  const experience: number[] = [];
  const victory = createPlayerCampaignVictory({ commit: next => { progress = next; }, get: () => progress,
    grantExperience: xp => experience.push(xp), localize: text => text, now: () => Date.UTC(2026, 10, 11, 12),
    rewardsOn: () => rules.rewardsOn, walletOnly: () => rules.walletOnly });
  return { experience, progress: () => progress, victory };
};

describe("campaign victory reward under the rules", () => {
  it("pays and records nothing with rewards off", async () => {
    const player = guestVictory({ rewardsOn: false, walletOnly: false });
    expect(await player.victory.claim(wonRun())).toBeUndefined();
    expect(player.progress()).toMatchObject({ gems: 0 });
    expect(player.progress().campaignVictories).toBeUndefined();
    expect(player.experience).toEqual([]);
  });

  it("asks no server with rewards off", async () => {
    const claimCampaignVictory = vi.fn();
    const progress = createPlayerProgress(1);
    const victory = createPlayerCampaignVictory({ commit: () => undefined, economy: { claimCampaignVictory },
      get: () => progress, grantExperience: () => undefined, localize: text => text, now: () => 0,
      rewardsOn: () => false });
    expect(await victory.claim({ ...wonRun(), attemptId: "attempt" })).toBeUndefined();
    expect(claimCampaignVictory).not.toHaveBeenCalled();
  });

  it("pays only the wallet kinds without a home island", async () => {
    const player = guestVictory({ rewardsOn: true, walletOnly: true });
    expect(await player.victory.claim(wonRun())).toEqual({ goods: {}, settlers: 0, soldiers: [] });
    expect(player.progress().gems).toBe(9);
    expect(player.experience).toEqual([12]);
  });
});

describe("home reward claims under the rules", () => {
  it("submits nothing while rewards are off and keeps the claim pending", async () => {
    const pending = [{ occurrence: "0", rewardId: "reward-1" }];
    const simulation = { confirmHomeClaim: vi.fn(), observeTicks: () => () => undefined,
      pendingHomeClaims: () => pending } as never;
    const claim = vi.fn(async () => ({ goods: {}, xp: 0 }));
    let rewardsOn = false;
    const submitter = createHomeClaimSubmitter({ claim, grantExperience: () => {}, log: () => {},
      rewardsOn: () => rewardsOn, simulation });
    await submitter.flush();
    expect(claim).not.toHaveBeenCalled();
    rewardsOn = true;
    await submitter.flush();
    expect(claim).toHaveBeenCalledTimes(1);
    submitter.dispose();
  });
});

describe("reward displays under the rules", () => {
  const entries: RewardEntry[] = [{ amount: 5, kind: "xp" }, { amount: 3, kind: "coins" }];

  it("show everything, drop experience, or show nothing", () => {
    expect(displayedRewardEntries(entries, { experienceRewarded: true, rewardsShown: true })).toBe(entries);
    expect(displayedRewardEntries(entries, { experienceRewarded: false, rewardsShown: true }))
      .toEqual([{ amount: 3, kind: "coins" }]);
    expect(displayedRewardEntries(entries, { experienceRewarded: true, rewardsShown: false })).toEqual([]);
  });

  it("a completed campaign map names its replay reward only while rewards are on", () => {
    const choice = { campaign: {}, completed: true, edges: [],
      maps: [{ map: { id: "bay", name: "Bay" }, node: "completed", status: "completed" }] } as unknown as CampaignChoice;
    expect(campaignMapRows(choice, undefined)[0]!.statusText).toMatch(/replay pays/);
    expect(campaignMapRows({ ...choice, rewardsShown: false }, undefined)[0]!.statusText).toBe("Completed");
  });
});
