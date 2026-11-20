import { describe, expect, it } from "vitest";

import { type CampaignMap, createCampaignMap } from "../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  cloneGameSettings, DEFAULT_ONLINE_SETTINGS, GAME_SETTINGS_PRESETS
} from "../../island-of-settlers-shared/src/game-settings/game-settings";
import { LAUNCH_CARGO_FILTER, WALLET_REWARD_FILTER } from "../src/app/map-editor/campaign/map-settings/constants";
import {
  cargoEntries, cargoFromEntries, mapModeView, mapModeWarnings, mapRewardEntries, scopedRewardEntries,
  withRewardEntries, withScopedRewardEntries, withSoldierCap
} from "../src/app/map-editor/campaign/map-settings/helpers";

const STORY = GAME_SETTINGS_PRESETS.story;
const WALLET_STORY = cloneGameSettings(STORY);
WALLET_STORY.progression.rewards = true;

const richMap = (): CampaignMap => ({
  ...createCampaignMap("m1", "c1", { id: "slot-1" } as never),
  requiredCargo: { goods: [{ amount: 12, ware: "planks" }], settlers: 3, soldiers: [{ amount: 4, type: "shield" }] },
  rewards: {
    coins: 250, decorations: [{ amount: 1, item: "statue" }], gems: 5, goods: [{ amount: 30, ware: "planks" }],
    settlers: 2, soldiers: [{ amount: 3, rank: 1, type: "archer" }], xp: 40
  },
  soldierCap: 20,
  unlock: [{ kind: "playerLevel", level: 3 }, { goods: [{ amount: 5, ware: "planks" }], kind: "homeGoods" }]
});

describe("rewards by reward scope (owner Q2)", () => {
  it("edits every reward line with a home island, exactly as before", () => {
    const { rewards } = richMap();
    const { hidden, shown } = scopedRewardEntries(rewards, "all");
    expect(hidden).toEqual([]);
    expect(shown).toEqual(mapRewardEntries(rewards));
    expect(withScopedRewardEntries(rewards, shown, "all")).toEqual(withRewardEntries(rewards, shown));
    expect(withScopedRewardEntries(rewards, shown, "all")).toEqual(rewards);
  });

  it("shows only gems and XP without a home and keeps every hidden line through an edit", () => {
    const { rewards } = richMap();
    const { shown } = scopedRewardEntries(rewards, "wallet");
    expect(shown.map(entry => entry.kind).sort()).toEqual(["gems", "xp"]);
    const edited = withScopedRewardEntries(rewards, [{ amount: 9, kind: "gems" }], "wallet");
    expect(edited).toEqual({ ...rewards, gems: 9, xp: 0 });
    expect(withScopedRewardEntries(edited, scopedRewardEntries(edited, "wallet").shown, "wallet")).toEqual(edited);
    expect(WALLET_REWARD_FILTER({ amount: 1, kind: "coins" })).toBe(false);
    expect(WALLET_REWARD_FILTER({ amount: 1, kind: "xp" })).toBe(true);
  });

  it("hides the rewards when the game pays none and counts what is kept", () => {
    const view = mapModeView(richMap(), STORY);
    expect(view).toMatchObject({ hiddenRewards: 7, rewards: [], scope: "none" });
    expect(mapModeView(richMap(), WALLET_STORY)).toMatchObject({ hiddenRewards: 5, scope: "wallet" });
    expect(mapModeView(richMap(), DEFAULT_ONLINE_SETTINGS)).toMatchObject({ hiddenRewards: 0, scope: "all" });
  });
});

describe("launch cargo by mode", () => {
  it("round-trips the required cargo through the picker lines", () => {
    const { requiredCargo } = richMap();
    const entries = cargoEntries(requiredCargo);
    expect(entries).toEqual([
      { amount: 12, kind: "ware", ware: "planks" }, { amount: 4, kind: "soldier", rank: 0, soldierType: "shield" },
      { amount: 3, kind: "settlers" }
    ]);
    expect(cargoFromEntries(entries)).toEqual(requiredCargo);
    expect(cargoFromEntries([...entries, { amount: 2, kind: "gems" }, { amount: 1, item: "statue", kind: "decoration" }]))
      .toEqual(requiredCargo);
    expect(LAUNCH_CARGO_FILTER({ amount: 1, kind: "soldier", rank: 2, soldierType: "shield" })).toBe(false);
    expect(LAUNCH_CARGO_FILTER({ amount: 1, kind: "soldier", rank: 0, soldierType: "shield" })).toBe(true);
    expect(LAUNCH_CARGO_FILTER({ amount: 1, kind: "ware", ware: "planks" })).toBe(true);
  });

  it("shows the launch cargo only with a home island; the hidden cargo stays in the record", () => {
    const map = richMap();
    expect(mapModeView(map, DEFAULT_ONLINE_SETTINGS).launchCargo).toHaveLength(3);
    expect(mapModeView(map, STORY).launchCargo).toBeNull();
    // A rewards edit made without a home leaves the hidden cargo, cap and unlock conditions untouched.
    const edited = { ...map, rewards: withScopedRewardEntries(map.rewards, [], "none") };
    expect(edited).toEqual(map);
  });

  it("clamps the soldier cap to a whole count", () => {
    expect(withSoldierCap(richMap(), "7.9").soldierCap).toBe(7);
    expect(withSoldierCap(richMap(), "").soldierCap).toBe(0);
    expect(withSoldierCap(richMap(), "-4").soldierCap).toBe(0);
    expect(withSoldierCap(richMap(), "99999999").soldierCap).toBe(10_000);
  });
});

describe("mode warnings beside the map settings", () => {
  it("groups the record's warnings by code and follows a mode switch", () => {
    const empty = createCampaignMap("m2", "c1", { id: "slot-2" } as never);
    expect(mapModeWarnings(empty, DEFAULT_ONLINE_SETTINGS)).toEqual([
      { code: "campaignMapNoRewards", count: 1 }, { code: "campaignMapNoLaunchCargo", count: 1 }
    ]);
    expect(mapModeWarnings(empty, STORY)).toEqual([]);
    const map = richMap();
    map.unlock.push({ buildingType: 4, count: 1, kind: "homeBuilding", minLevel: 1 });
    expect(mapModeWarnings(map, STORY)).toEqual([{ code: "campaignMapHomeUnlock", count: 2 }]);
    expect(mapModeWarnings(map, DEFAULT_ONLINE_SETTINGS)).toEqual([]);
  });
});
