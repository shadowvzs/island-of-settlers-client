import { setupI18n } from "@lingui/core";
import { describe, expect, it } from "vitest";

import {
  foldSearchText, isRewardDecorationId, rewardDecorationIds, rewardPickerOptions
} from "../src/app/map-editor/reward-picker/catalog";
import { MAX_REWARD_AMOUNT, MAX_SETTLER_REWARD } from "../src/app/map-editor/reward-picker/constants";
import {
  clampRewardAmount, filterRewardOptions, groupedSelectedRewardRows, selectedRewardRows, unknownDecorationId,
  withRewardAdded,
  withRewardAmount, withRewardRemoved, withRewardToggled
} from "../src/app/map-editor/reward-picker/helpers";
import { searchLocales } from "../src/app/map-editor/reward-picker/search-locales";
import type { RewardEntry } from "../src/app/settlement-ui/reward-icons/entries";
import { messages as english } from "../src/locales/en/messages";

const i18n = setupI18n({ locale: "en", messages: { en: english } });
const context = { i18n, nation: "roman", searchLocales: searchLocales() };
const kindsOf = (tab: Parameters<typeof rewardPickerOptions>[0]) =>
  new Set(rewardPickerOptions(tab, context).map(option => option.entry.kind));

describe("reward picker catalog", () => {
  it("offers wares, people, decorations and misc rewards on their own tabs", () => {
    expect(kindsOf("wares")).toEqual(new Set(["ware"]));
    expect(rewardPickerOptions("wares", context).some(option => option.key === "ware:coins")).toBe(false);
    expect(kindsOf("people")).toEqual(new Set(["settlers", "soldier"]));
    const soldiers = rewardPickerOptions("people", context).filter(option => option.entry.kind === "soldier");
    expect(soldiers).toHaveLength(9);
    expect(kindsOf("decorations")).toEqual(new Set(["decoration"]));
    expect(rewardPickerOptions("decorations", context)).toHaveLength(rewardDecorationIds().length);
    expect(rewardPickerOptions("misc", context).map(option => option.key)).toEqual(["coins", "gems", "xp"]);
  });

  it("offers the recruit (rank 0) of every campaign soldier type, found by the word recruit", () => {
    const people = rewardPickerOptions("people", context);
    const recruits = filterRewardOptions(people, "recruit");
    expect(recruits.map(option => option.key).sort())
      .toEqual(["soldier:archer:0", "soldier:heavy:0", "soldier:shield:0"]);
    expect(recruits.every(option => option.label.endsWith("(rank 1, recruit)"))).toBe(true);
    expect(people.some(option => option.entry.kind === "soldier" && option.entry.rank === undefined)).toBe(false);
  });

  it("decoration rewards come from the registry only", () => {
    const [first] = rewardDecorationIds();
    expect(first).toMatch(/^roadDecoration:/);
    expect(isRewardDecorationId(first!)).toBe(true);
    expect(isRewardDecorationId("banner-oak")).toBe(false);
    expect(unknownDecorationId({ amount: 1, item: "banner-oak", kind: "decoration" })).toBe("banner-oak");
    expect(unknownDecorationId({ amount: 1, item: first!, kind: "decoration" })).toBeNull();
  });
});

describe("reward picker search", () => {
  it("ignores case and diacritics and matches English or Hungarian names", () => {
    expect(foldSearchText("  Kőfaragó ÁRU ")).toBe("kofarago aru");
    const wares = rewardPickerOptions("wares", context);
    const planks = filterRewardOptions(wares, "PLANK");
    expect(planks.map(option => option.key)).toContain("ware:planks");
    const hungarianPlanks = filterRewardOptions(wares, "deszka");
    expect(hungarianPlanks.map(option => option.key)).toContain("ware:planks");
    expect(filterRewardOptions(wares, "dészká")).toEqual(hungarianPlanks);
    expect(filterRewardOptions(wares, "")).toBe(wares);
    expect(filterRewardOptions(wares, "zzz-nothing")).toEqual([]);
  });
});

describe("reward picker selection", () => {
  const planks: RewardEntry = { amount: 1, kind: "ware", ware: "planks" };
  const settlers: RewardEntry = { amount: 1, kind: "settlers" };

  it("adds once, toggles off and removes by key", () => {
    const once = withRewardAdded(withRewardAdded([], planks), planks);
    expect(once).toEqual([planks]);
    expect(withRewardToggled(once, settlers)).toEqual([planks, settlers]);
    expect(withRewardToggled(once, planks)).toEqual([]);
    expect(withRewardRemoved([planks, settlers], "settlers")).toEqual([planks]);
  });

  it("clamps amounts to whole numbers within each kind's limits", () => {
    expect(clampRewardAmount(planks, "")).toBe(1);
    expect(clampRewardAmount(planks, "-5")).toBe(1);
    expect(clampRewardAmount(planks, "12.7")).toBe(12);
    expect(clampRewardAmount(planks, 1e12)).toBe(MAX_REWARD_AMOUNT);
    expect(clampRewardAmount(settlers, 1e9)).toBe(MAX_SETTLER_REWARD);
    expect(withRewardAmount([planks, settlers], "ware:planks", 40)).toEqual([{ ...planks, amount: 40 }, settlers]);
    const unlock: RewardEntry = { buildingType: 3, kind: "buildingUnlock" };
    expect(withRewardAmount([unlock], "building:3", 5)).toEqual([unlock]);
  });

  it("selected rows carry names, limits and a warning for unknown decoration ids", () => {
    const rows = selectedRewardRows([planks, { amount: 2, item: "banner-oak", kind: "decoration" }], "roman", i18n);
    expect(rows[0]).toMatchObject({ amount: 1, key: "ware:planks", max: MAX_REWARD_AMOUNT, warning: "" });
    expect(rows[1]!.warning).toContain("banner-oak");
  });

  it("groups coins, XP and gems on one currency row in a fixed order, other rewards keep list order", () => {
    const entries: RewardEntry[] = [{ amount: 9, kind: "gems" }, planks, { amount: 50_000, kind: "xp" }, settlers,
      { amount: 400, kind: "coins" }];
    const { currencies, items } = groupedSelectedRewardRows(entries, "roman", i18n);
    expect(currencies.map(row => row.key)).toEqual(["coins", "xp", "gems"]);
    expect(currencies.map(row => row.amount)).toEqual([400, 50_000, 9]);
    expect(items.map(row => row.key)).toEqual(["ware:planks", "settlers"]);
  });
});
