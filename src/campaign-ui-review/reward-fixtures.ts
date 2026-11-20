import type { I18n } from "@lingui/core";

import { BuildingType } from "../../../island-of-settlers-shared/src/building-types";
import { adventureOutcomePopup } from "../app/settlement-ui/colony-announcements";
import { levelUpPopup } from "../app/settlement-ui/level-up-popup";
import { getPopupView } from "../app/settlement-ui/popup/helpers";
import type { RewardEntry } from "../app/settlement-ui/reward-icons/entries";
import { getRewardIconsView, type RewardIconsOptions } from "../app/settlement-ui/reward-icons/helpers";
import type { AdventureIsland } from "../shared/settlement/adventure-rules";

/** Every reward kind once, with soldier ranks, a building unlock and grouped decorations. */
const EVERY_KIND: RewardEntry[] = [
  { amount: 900, kind: "xp" },
  { amount: 300, kind: "coins" },
  { amount: 10, kind: "gems" },
  { amount: 40, kind: "ware", ware: "planks" },
  { amount: 6, kind: "ware", ware: "sword" },
  { amount: 4, kind: "soldier", rank: 0, soldierType: "shield" },
  { amount: 2, kind: "soldier", rank: 2, soldierType: "heavy" },
  { amount: 3, kind: "soldier", soldierType: "archer" },
  { amount: 5, kind: "settlers" },
  { buildingType: BuildingType.Fishery, kind: "buildingUnlock" },
  { amount: 2, item: "roadDecoration:roman-rusticated-arch:limestone", kind: "decoration" },
  { amount: 1, item: "roadDecoration:japanese-stone-lantern:granite", kind: "decoration" }
];

/** An item id without a catalogue entry and a reward kind this build does not know: both use the fallback. */
const FALLBACKS = [
  { amount: 1, item: "roadDecoration:retired-statue:marble", kind: "decoration" },
  { amount: 2, kind: "banner" } as unknown as RewardEntry
] satisfies RewardEntry[];

interface GalleryRow {
  className?: string;
  entries: RewardEntry[];
  options?: Omit<RewardIconsOptions, "i18n">;
  title: string;
}
const GALLERY_ROWS: GalleryRow[] = [
  { entries: EVERY_KIND, options: { maxItems: 20 }, title: "Every kind (Roman)" },
  { entries: EVERY_KIND, title: "Default limit: 8 slots with \"+N more\"" },
  { entries: EVERY_KIND, options: { maxItems: 20, nation: "viking" }, title: "Viking nation" },
  { className: "reward-icons--compact", entries: EVERY_KIND.slice(0, 5), options: { signed: true },
    title: "Compact (quest window)" },
  { entries: FALLBACKS, title: "Fallbacks: unknown decoration, unknown kind" }
];

/** The gallery rows' prepared reward views. */
export const getRewardGallery = (i18n: I18n) => GALLERY_ROWS.map(row => ({
  className: row.className,
  title: row.title,
  view: getRewardIconsView(row.entries, { ...row.options, i18n })
}));

const REVIEW_ISLAND = { name: "Gull Rock" } as AdventureIsland;
const ADVENTURE_GOODS = { coins: 180, hardwoodPlanks: 24, iron: 8, bread: 30, sword: 4 };

/** The settlement popups that carry rewards: a won adventure (experience and goods) and a level-up. */
export const getReviewPopup = (kind: "level-up-popup" | "reward-popup", i18n: I18n) => {
  if (kind === "level-up-popup") {
    return getPopupView(levelUpPopup([{ coins: 120, gems: 3, level: 8 }], "roman", undefined, i18n), i18n);
  }
  return getPopupView(adventureOutcomePopup("won", REVIEW_ISLAND, "roman",
    { experience: 1500, goods: ADVENTURE_GOODS }, undefined, i18n), i18n);
};
