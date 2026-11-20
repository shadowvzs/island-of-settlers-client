import { expect, it } from "vitest";

import type { CampaignIssue } from "../../island-of-settlers-shared/src/campaign/campaign-issues";
import { createCampaignMap } from "../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  DEFAULT_ONLINE_SETTINGS, GAME_SETTINGS_PRESETS
} from "../../island-of-settlers-shared/src/game-settings/game-settings";
import type { CampaignMapFile } from "../src/shared/campaign/campaign-map-file-checks";
import { checkStoryStart, checkXpReward } from "../src/shared/campaign/campaign-map-start-checks";
import { checkModeRewards } from "../src/shared/campaign/game-mode/map-mode-checks";
import { createMapScenario, type MapScenario } from "../src/shared/world/map-scenario";

const mapRecord = () => createCampaignMap("m1", "c1", { id: "slot-1" } as never);
const mapFile = (change: Partial<MapScenario>): CampaignMapFile => ({
  scenario: { ...createMapScenario(), kind: "campaign", ...change }, world: { playableIslands: [] } as never
});
const codes = (run: (issues: CampaignIssue[]) => void) => {
  const issues: CampaignIssue[] = [];
  run(issues);
  return issues.map(issue => issue.code);
};

it("warns about a campaign map nobody could play without a home, unless its start setup is off", () => {
  const story = GAME_SETTINGS_PRESETS.story;
  const start = (change: Partial<MapScenario>, settings = story) =>
    codes(issues => checkStoryStart(mapFile(change), settings, issues));
  expect(start({ settlers: 0 })).toEqual(["campaignMapNoStoryStart"]);
  expect(start({ settlers: 4 })).toEqual([]);
  expect(start({ settlers: 0, startTroops: [{ count: 1, rank: 0, type: "shield" }] })).toEqual([]);
  expect(start({ settlers: 0, startSetup: "off" })).toEqual([]);
  // With a home the expedition brings its cargo: the map's own start setup is not used (MODE-EDITOR).
  expect(start({ settlers: 0 }, DEFAULT_ONLINE_SETTINGS)).toEqual([]);
});

it("asks for victory rewards only in the home-island mode", () => {
  const map = mapRecord();
  expect(codes(issues => checkModeRewards(map, DEFAULT_ONLINE_SETTINGS, issues))).toEqual(["campaignMapNoRewards"]);
  expect(codes(issues => checkModeRewards(map, GAME_SETTINGS_PRESETS.story, issues))).toEqual([]);
  map.rewards.coins = 10;
  expect(codes(issues => checkModeRewards(map, DEFAULT_ONLINE_SETTINGS, issues))).toEqual([]);
});

it("flags an XP reward on a map that switches experience off", () => {
  const map = mapRecord();
  map.rewards.xp = 50;
  expect(codes(issues => checkXpReward(map, mapFile({ rules: { experience: "none" } }), issues)))
    .toEqual(["mapRulesXpReward"]);
  expect(codes(issues => checkXpReward(map, mapFile({}), issues))).toEqual([]);
});
