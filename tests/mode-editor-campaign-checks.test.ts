import { expect, it } from "vitest";

import { createCampaignMap } from "../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  cloneGameSettings, DEFAULT_ONLINE_SETTINGS, GAME_SETTINGS_PRESETS, type GameSettings
} from "../../island-of-settlers-shared/src/game-settings/game-settings";
import { mapRecordModeIssues } from "../src/shared/campaign/game-mode/map-mode-checks";
import { isRewardKindPaid, rewardScopeOf } from "../src/shared/campaign/game-mode/reward-scope";

const STORY = GAME_SETTINGS_PRESETS.story;
const withRewards = (settings: GameSettings, rewards: boolean) => {
  const next = cloneGameSettings(settings);
  next.progression.rewards = rewards;
  return next;
};
const mapRecord = () => createCampaignMap("m1", "c1", { id: "slot-1" } as never);
const codes = (map: ReturnType<typeof mapRecord>, settings: GameSettings) =>
  mapRecordModeIssues(map, settings).map(issue => issue.code);

it("resolves the reward scope from the rewards switch and the home island", () => {
  expect(rewardScopeOf(DEFAULT_ONLINE_SETTINGS)).toBe("all");
  expect(rewardScopeOf(withRewards(DEFAULT_ONLINE_SETTINGS, false))).toBe("none");
  expect(rewardScopeOf(STORY)).toBe("none");
  expect(rewardScopeOf(withRewards(STORY, true))).toBe("wallet");
  expect(["coins", "gems", "xp", "ware"].filter(kind => isRewardKindPaid("wallet", kind))).toEqual(["gems", "xp"]);
  expect(isRewardKindPaid("all", "decoration")).toBe(true);
  expect(isRewardKindPaid("none", "gems")).toBe(false);
});

it("warns in the home-island mode about a map without rewards and without launch people", () => {
  const map = mapRecord();
  expect(codes(map, DEFAULT_ONLINE_SETTINGS)).toEqual(["campaignMapNoRewards", "campaignMapNoLaunchCargo"]);
  map.rewards.gems = 5;
  map.requiredCargo.soldiers = [{ amount: 3, type: "shield" }];
  expect(codes(map, DEFAULT_ONLINE_SETTINGS)).toEqual([]);
  map.requiredCargo = { goods: [{ amount: 9, ware: "planks" }], settlers: 0, soldiers: [] };
  expect(codes(map, DEFAULT_ONLINE_SETTINGS)).toEqual(["campaignMapNoLaunchCargo"]);
  map.requiredCargo.settlers = 2;
  expect(codes(map, DEFAULT_ONLINE_SETTINGS)).toEqual([]);
});

it("asks for no rewards when the home-island game switches rewards off", () => {
  expect(codes(mapRecord(), withRewards(DEFAULT_ONLINE_SETTINGS, false))).toEqual(["campaignMapNoLaunchCargo"]);
});

it("warns without a home only about home-bound unlock conditions, and shows the home warnings after a switch", () => {
  const map = mapRecord();
  map.unlock = [
    { kind: "playerLevel", level: 3 }, { goods: [{ amount: 5, ware: "planks" }], kind: "homeGoods" },
    { buildingType: 4, count: 1, kind: "homeBuilding", minLevel: 1 }
  ];
  const story = mapRecordModeIssues(map, STORY);
  expect(story.map(issue => [issue.code, issue.path])).toEqual([
    ["campaignMapHomeUnlock", "unlock[1]"], ["campaignMapHomeUnlock", "unlock[2]"]
  ]);
  expect(codes(map, withRewards(STORY, true))).toEqual(["campaignMapHomeUnlock", "campaignMapHomeUnlock"]);
  // The same record after the admin switches to the home-island mode: the home warnings appear instead.
  expect(codes(map, DEFAULT_ONLINE_SETTINGS)).toEqual(["campaignMapNoRewards", "campaignMapNoLaunchCargo"]);
});
