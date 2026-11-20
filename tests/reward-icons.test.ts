import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BuildingType } from "../../island-of-settlers-shared/src/building-types";
import {
  campaignMapRewardEntries, campaignRewardEntries, goodsRewardEntries, type RewardEntry
} from "../src/app/settlement-ui/reward-icons/entries";
import {
  describeRewardEntry, getRewardIconsView, groupRewardEntries
} from "../src/app/settlement-ui/reward-icons/helpers";
import { RewardIcons } from "../src/app/settlement-ui/reward-icons/reward-icons";
import { messages as english } from "../src/locales/en/messages";
import { messages as hungarian } from "../src/locales/hu/messages";

const i18n = setupI18n({ locale: "en", messages: { en: english, hu: { ...english, ...hungarian } } });
const ARCH = "roadDecoration:roman-rusticated-arch:limestone";
const LANTERN = "roadDecoration:japanese-stone-lantern:granite";
const image = (pattern: RegExp, crop?: string) =>
  ({ ...(crop && { crop }), kind: "image", source: expect.stringMatching(pattern) });
const describeEn = (entry: RewardEntry, nation = "roman") => describeRewardEntry(entry, nation, i18n);

describe("reward icon mapping", () => {
  it("maps every reward kind to a rendered icon and its name", () => {
    expect(describeEn({ amount: 5, kind: "coins" })).toEqual({ icon: { kind: "ware", ware: "coins" },
      label: "Gold coins" });
    expect(describeEn({ amount: 5, kind: "gems" })).toEqual({ icon: image(/gem/), label: "Gems" });
    expect(describeEn({ amount: 5, kind: "ware", ware: "planks" })).toEqual({ icon: { kind: "ware", ware: "planks" },
      label: "Softwood planks" });
    expect(describeEn({ amount: 1, item: ARCH, kind: "decoration" })).toEqual({
      icon: image(/icons\/road-decorations\/roman-rusticated-arch-limestone\.png$/),
      label: "Roman rusticated arch · Limestone"
    });
    expect(describeEn({ amount: 2, kind: "soldier", soldierType: "shield" })).toEqual({
      icon: image(/roman-shield/, "soldier"), label: expect.any(String)
    });
    expect(describeEn({ amount: 2, kind: "settlers" })).toEqual({ icon: image(/carrier/, "settler"), label: "Settlers" });
    expect(describeEn({ buildingType: BuildingType.Fishery, kind: "buildingUnlock" })).toEqual({
      icon: { kind: "building", type: BuildingType.Fishery }, label: "Unlocks Fishery"
    });
  });

  it("uses the soldier's rank portrait, the rank in its name and the player's nation", () => {
    const ranked = describeEn({ amount: 1, kind: "soldier", rank: 2, soldierType: "heavy" }, "viking");
    expect(ranked.icon).toEqual(image(/viking-heavy-rank2/, "soldier"));
    expect(ranked.label).toMatch(/ \(rank 3\)$/);
    expect(describeEn({ amount: 1, kind: "soldier", soldierType: "archer" }, "nubian").icon)
      .toEqual(image(/nubian-archer/, "soldier"));
    expect(describeEn({ amount: 1, kind: "soldier", soldierType: "cavalry" }).icon, "mounted: no crop")
      .toEqual(image(/roman-cavalry/));
  });

  it("names the lowest rank and a rankless soldier a recruit, with the recruit portrait", () => {
    const recruit = describeEn({ amount: 1, kind: "soldier", rank: 0, soldierType: "shield" });
    expect(recruit.icon).toEqual(image(/roman-shield-rank0/, "soldier"));
    expect(recruit.label).toMatch(/ \(rank 1, recruit\)$/);
    expect(describeEn({ amount: 1, kind: "soldier", soldierType: "shield" }).label).toMatch(/ \(recruit\)$/);
    expect(describeEn({ amount: 1, kind: "soldier", rank: 1, soldierType: "shield" }).label).toMatch(/ \(rank 2\)$/);
  });

  it("falls back to the quest scroll render with the id for unknown kinds and items", () => {
    expect(describeEn({ amount: 1, kind: "banner" } as unknown as RewardEntry))
      .toEqual({ icon: image(/quest-scroll/), label: "Reward: banner" });
    expect(describeEn({ amount: 1, item: "roadDecoration:retired-statue:marble", kind: "decoration" }))
      .toEqual({ icon: image(/quest-scroll/), label: "Reward: roadDecoration:retired-statue:marble" });
  });
});

describe("reward grouping and overflow", () => {
  it("merges equal rewards, drops empty amounts and orders by kind with decorations grouped last", () => {
    const grouped = groupRewardEntries([
      { amount: 1, item: ARCH, kind: "decoration" },
      { amount: 3, kind: "ware", ware: "planks" },
      { amount: 0, kind: "gems" },
      { amount: 2, item: ARCH, kind: "decoration" },
      { amount: 1, item: LANTERN, kind: "decoration" },
      { amount: 4, kind: "settlers" },
      { amount: 10, kind: "coins" },
      { amount: 2, kind: "ware", ware: "planks" },
      { buildingType: BuildingType.Fishery, kind: "buildingUnlock" },
      { amount: 1, kind: "soldier", rank: 1, soldierType: "shield" },
      { amount: 1, kind: "soldier", soldierType: "shield" }
    ]);
    expect(grouped).toEqual([
      { amount: 10, kind: "coins" },
      { amount: 5, kind: "ware", ware: "planks" },
      { amount: 1, kind: "soldier", rank: 1, soldierType: "shield" },
      { amount: 1, kind: "soldier", soldierType: "shield" },
      { amount: 4, kind: "settlers" },
      { buildingType: BuildingType.Fishery, kind: "buildingUnlock" },
      { amount: 3, item: ARCH, kind: "decoration" },
      { amount: 1, item: LANTERN, kind: "decoration" }
    ]);
  });

  it("shows the experience as the badge and formats counts, signed for quest previews", () => {
    const view = getRewardIconsView([{ amount: 900, kind: "xp" }, { amount: 600, kind: "xp" },
      { amount: 1200, kind: "coins" }, { buildingType: BuildingType.Fishery, kind: "buildingUnlock" }], { i18n });
    expect(view.experience).toEqual({ icon: expect.stringMatching(/level-star/), text: "+1,500 XP" });
    expect(view.items.map(item => [item.count, item.ariaLabel, item.label])).toEqual([
      ["1,200", "1,200 Gold coins", "Gold coins"], ["", "Unlocks Fishery", "Unlocks Fishery"]]);
    expect(view.overflow).toBeNull();
    const signed = getRewardIconsView([{ amount: 20, kind: "coins" }], { i18n, signed: true });
    expect(signed.items[0]?.count).toBe("+20");
    expect(signed.experience).toBeNull();
  });

  it("is empty without rewards", () => {
    expect(getRewardIconsView([{ amount: 0, kind: "xp" }, { amount: 0, kind: "coins" }], { i18n }))
      .toMatchObject({ experience: null, hasRewards: false, items: [], overflow: null });
  });

  it("ends a long list with a '+N more' chip that names the hidden rewards within the slot limit", () => {
    const decorations = Array.from({ length: 6 }, (_, index): RewardEntry =>
      ({ amount: index + 1, item: `${ARCH}-${index}`, kind: "decoration" }));
    const entries: RewardEntry[] = [{ amount: 9, kind: "coins" }, { amount: 2, kind: "gems" }, ...decorations];
    expect(getRewardIconsView(entries, { i18n, maxItems: 8 }).overflow).toBeNull();
    const view = getRewardIconsView(entries, { i18n, maxItems: 5 });
    expect(view.items).toHaveLength(4);
    expect(view.overflow).toEqual({
      ariaLabel: expect.stringMatching(/^4 more rewards: 3 Reward: /),
      label: expect.stringContaining("6 Reward: "),
      text: "+4 more"
    });
  });
});

describe("reward entry builders", () => {
  it("turns goods records, campaign rewards and map rewards into entries", () => {
    expect(goodsRewardEntries({ bread: 3, coins: 20, planks: 4 }), "inventory order").toEqual([
      { amount: 4, kind: "ware", ware: "planks" }, { amount: 20, kind: "coins" },
      { amount: 3, kind: "ware", ware: "bread" }]);
    expect(campaignRewardEntries({ coins: 5, decorations: [{ amount: 1, item: ARCH }], gems: 2,
      goods: [{ amount: 3, ware: "coins" }, { amount: 4, ware: "sword" }], xp: 50 })).toEqual([
      { amount: 50, kind: "xp" }, { amount: 5, kind: "coins" }, { amount: 2, kind: "gems" },
      { amount: 3, kind: "coins" }, { amount: 4, kind: "ware", ware: "sword" },
      { amount: 1, item: ARCH, kind: "decoration" }]);
    expect(campaignRewardEntries({ coins: 0, decorations: [], gems: 0, goods: [], settlers: 6,
      soldiers: [{ amount: 2, rank: 1, type: "heavy" }, { amount: 1, type: "shield" }], xp: 0 })).toEqual([
      { amount: 0, kind: "xp" }, { amount: 0, kind: "coins" }, { amount: 0, kind: "gems" },
      { amount: 2, kind: "soldier", rank: 1, soldierType: "heavy" }, { amount: 1, kind: "soldier", soldierType: "shield" },
      { amount: 6, kind: "settlers" }]);
    expect(campaignMapRewardEntries({ goods: [{ amount: 2, ware: "axe" }],
      soldiers: [{ amount: 3, type: "archer" }] })).toEqual([
      { amount: 2, kind: "ware", ware: "axe" }, { amount: 3, kind: "soldier", soldierType: "archer" }]);
  });
});

describe("reward icons view", () => {
  it("renders the badge, fixed-size icons with name tooltips and the overflow chip", () => {
    const view = getRewardIconsView([{ amount: 40, kind: "xp" }, { amount: 2, item: ARCH, kind: "decoration" },
      { amount: 1, kind: "settlers" }, { amount: 3, kind: "gems" }], { i18n, maxItems: 2 });
    const markup = renderToStaticMarkup(createElement(I18nProvider, { i18n },
      createElement(RewardIcons, { className: "reward-icons--compact", view })));
    expect(markup).toContain('<div aria-label="Rewards" class="reward-icons reward-icons--compact" role="group">');
    expect(markup).toContain('<span>+40 XP</span>');
    expect(markup).toContain('<li aria-label="3 Gems" class="reward-icons__item" title="Gems">');
    expect(markup).toContain('class="reward-icons__item reward-icons__more" title="1 Settlers, '
      + '2 Roman rusticated arch · Limestone">+2 more</li>');
  });
});
