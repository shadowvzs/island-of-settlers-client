import type { I18n } from "@lingui/core";

import { getRoadDecorationItem } from "../../../../../island-of-settlers-shared/src/road-decoration-items";
import { getNationBuildingDefinition } from "../../../render-common/buildings/nation-building-text";
import { displayWareName } from "../../../shared/i18n/domain";
import { translateMessage } from "../../../shared/i18n/translate";
import type { MilitaryTroopType } from "../../../shared/settlement/military-combat-rules";
import { playerItemName } from "../../player-inventory/item-presentation";
import { roadDecorationIconUrl } from "../../player-inventory/road-decoration-presentation";
import { troopPortrait } from "../../settlement/army-icons";
import { troopPluralName } from "../../settlement/troop-names";
import { getWorkerPortraitSource } from "../building-details/workforce-helpers";
import { formatWholeNumber } from "../helpers";
import { SETTLEMENT_MESSAGES } from "../messages";
import { progressionIcon } from "../player-hud-helpers";
import {
  COIN_WARE, DEFAULT_MAX_REWARD_ICONS, DEFAULT_REWARD_NATION, RECRUIT_SOLDIER_RANK, REWARD_KIND_ORDER,
  UNKNOWN_REWARD_ORDER
} from "./constants";
import type { RewardEntry } from "./entries";
import { REWARD_ICON_MESSAGES as M } from "./messages";

/**
 * Full-figure renders framed with headroom: the view crops them to the figure (`object-view-box`) so a unit stays
 * readable in the fixed icon slot.
 */
type RewardFigureCrop = "settler" | "soldier";

/** The picture of a reward: a rendered ware icon, a building thumbnail or a rendered image (portrait, item). */
export type RewardIconArt =
  | { kind: "building"; type: number }
  | { crop?: RewardFigureCrop; kind: "image"; source: string }
  | { kind: "ware"; ware: string };

/** One icon of a reward display; `label` is the tooltip (the reward's name). */
export interface RewardIconItem {
  ariaLabel: string;
  count: string;
  icon: RewardIconArt;
  key: string;
  label: string;
}

export interface RewardIconsOptions {
  i18n?: I18n;
  maxItems?: number;
  /** Soldier portraits, troop names and building unlocks follow the player's nation (Roman by default). */
  nation?: string;
  /** Counts read "+20" (quest previews) instead of "20" (granted rewards). */
  signed?: boolean;
}

const kindOrder = (entry: RewardEntry) => REWARD_KIND_ORDER[entry.kind] ?? UNKNOWN_REWARD_ORDER;

const entryAmount = (entry: RewardEntry) => ("amount" in entry ? entry.amount : 1);

/** One key per distinct reward (kind plus ware, item, soldier type/rank or building); amounts merge under it. */
export const rewardEntryKey = (entry: RewardEntry) => {
  if (entry.kind === "ware") return `ware:${entry.ware}`;
  if (entry.kind === "decoration") return `decoration:${entry.item}`;
  if (entry.kind === "soldier") return `soldier:${entry.soldierType}:${entry.rank ?? ""}`;
  if (entry.kind === "buildingUnlock") return `building:${entry.buildingType}`;
  return String(entry.kind);
};

const withAmount = (entry: RewardEntry, amount: number): RewardEntry =>
  ("amount" in entry ? { ...entry, amount } : entry);

/**
 * Merges entries of the same reward (summing amounts), drops empty amounts and sorts by kind; entries of one kind
 * keep their input order.
 */
export const groupRewardEntries = (entries: readonly RewardEntry[]): RewardEntry[] => {
  const grouped = new Map<string, RewardEntry>();
  for (const entry of entries) {
    const key = rewardEntryKey(entry);
    const previous = grouped.get(key);
    grouped.set(key, previous ? withAmount(previous, entryAmount(previous) + entryAmount(entry)) : entry);
  }
  return [...grouped.values()]
    .filter(entry => entryAmount(entry) > 0)
    .sort((left, right) => kindOrder(left) - kindOrder(right));
};

const imageIcon = (source: string, crop?: RewardFigureCrop): RewardIconArt =>
  (crop ? { crop, kind: "image", source } : { kind: "image", source });

/** The quest scroll render stands in for a reward without its own picture (an unknown kind or item). */
const fallbackIcon = () => imageIcon(progressionIcon("quest-scroll"));

const decorationLabel = (item: string, i18n?: I18n) => {
  if (!getRoadDecorationItem(item)) return translateMessage(i18n, M.unknown, { id: item });
  return playerItemName(item as Parameters<typeof playerItemName>[0], i18n);
};

const decorationIcon = (item: string) => {
  const source = roadDecorationIconUrl(item);
  return source ? imageIcon(source) : fallbackIcon();
};

/** Settlers arrive as carriers: the rendered carrier model. */
const settlersIcon = () => {
  const source = getWorkerPortraitSource("Carrier");
  return source ? imageIcon(source, "settler") : fallbackIcon();
};

/** Mounted troops fill their whole render, so only foot soldiers are cropped. */
const soldierIcon = (type: MilitaryTroopType, rank: number | undefined, nation: string) =>
  imageIcon(troopPortrait(nation, type, rank), type === "cavalry" ? undefined : "soldier");

/**
 * Ranks read 1..3 like the army views (stored 0..2). The lowest one is the recruit (owner 2026-11-13: recruits
 * are rewards too), and so is a line without a rank: the reward ship lands it at the recruit rank.
 */
const soldierLabel = (type: MilitaryTroopType, rank: number | undefined, nation: string, i18n?: I18n) => {
  const name = troopPluralName(nation, type, i18n);
  if (rank === undefined) return translateMessage(i18n, M.soldierRecruit, { name });
  const message = rank === RECRUIT_SOLDIER_RANK ? M.soldierRecruitRank : M.soldierRank;
  return translateMessage(i18n, message, { name, rank: rank + 1 });
};

interface RewardPresentation {
  icon: RewardIconArt;
  label: string;
}
/** The icon and name of one reward; an unknown kind keeps its id as text beside the fallback picture. */
export const describeRewardEntry = (entry: RewardEntry, nation: string, i18n?: I18n): RewardPresentation => {
  switch (entry.kind) {
  case "coins": return { icon: { kind: "ware", ware: COIN_WARE }, label: displayWareName(COIN_WARE, i18n) };
  case "gems":
    return { icon: imageIcon(progressionIcon("gem")), label: translateMessage(i18n, SETTLEMENT_MESSAGES.popup.gems) };
  case "ware": return { icon: { kind: "ware", ware: entry.ware }, label: displayWareName(entry.ware, i18n) };
  case "decoration": return { icon: decorationIcon(entry.item), label: decorationLabel(entry.item, i18n) };
  case "soldier": return {
    icon: soldierIcon(entry.soldierType, entry.rank, nation),
    label: soldierLabel(entry.soldierType, entry.rank, nation, i18n)
  };
  case "xp": return { icon: imageIcon(progressionIcon("level-star")), label: translateMessage(i18n, M.experience) };
  case "settlers": return { icon: settlersIcon(), label: translateMessage(i18n, M.settlers) };
  case "buildingUnlock": return {
    icon: { kind: "building", type: entry.buildingType },
    label: translateMessage(i18n, M.unlock, { name: getNationBuildingDefinition(entry.buildingType, nation).name })
  };
  default:
    return { icon: fallbackIcon(), label: translateMessage(i18n, M.unknown, { id: (entry as { kind: string }).kind }) };
  }
};

const countText = (entry: RewardEntry, signed: boolean) => {
  if (entry.kind === "buildingUnlock") return "";
  const count = formatWholeNumber(entryAmount(entry));
  return signed ? `+${count}` : count;
};

const toRewardIconItem = (entry: RewardEntry, options: RewardIconsOptions): RewardIconItem => {
  const { i18n, nation = DEFAULT_REWARD_NATION, signed = false } = options;
  const { icon, label } = describeRewardEntry(entry, nation, i18n);
  const count = countText(entry, signed);
  const ariaLabel = count ? translateMessage(i18n, SETTLEMENT_MESSAGES.popup.rewardItem, { count, label }) : label;
  return { ariaLabel, count, icon, key: rewardEntryKey(entry), label };
};

const getExperience = (entries: readonly RewardEntry[], i18n?: I18n) => {
  const amount = entries.reduce((sum, entry) => sum + (entry.kind === "xp" ? entry.amount : 0), 0);
  if (amount <= 0) return null;
  const text = translateMessage(i18n, SETTLEMENT_MESSAGES.common.plusXp, { amount: formatWholeNumber(amount) });
  return { icon: progressionIcon("level-star"), text };
};

const getOverflow = (hidden: readonly RewardIconItem[], i18n?: I18n) => {
  if (!hidden.length) return null;
  const names = hidden.map(item => item.ariaLabel).join(", ");
  return {
    ariaLabel: translateMessage(i18n, M.moreLabel, { count: hidden.length, names }),
    label: names,
    text: translateMessage(i18n, M.more, { count: hidden.length })
  };
};

/** Splits the icons so that, with the "+N more" chip, the display never shows more than `maxItems` slots. */
const splitVisible = (items: readonly RewardIconItem[], maxItems: number) => {
  if (items.length <= maxItems) return { hidden: [], visible: items };
  const shown = Math.max(1, maxItems - 1);
  return { hidden: items.slice(shown), visible: items.slice(0, shown) };
};

/**
 * Everything a reward display renders: the experience badge, one icon per reward (grouped, with counts) and an
 * overflow chip naming the rewards that did not fit.
 */
export const getRewardIconsView = (entries: readonly RewardEntry[], options: RewardIconsOptions = {}) => {
  const { i18n, maxItems = DEFAULT_MAX_REWARD_ICONS } = options;
  const items = groupRewardEntries(entries).filter(entry => entry.kind !== "xp")
    .map(entry => toRewardIconItem(entry, options));
  const { hidden, visible } = splitVisible(items, maxItems);
  const experience = getExperience(entries, i18n);
  return {
    experience,
    hasRewards: Boolean(experience) || items.length > 0,
    items: visible,
    label: translateMessage(i18n, SETTLEMENT_MESSAGES.popup.rewards),
    overflow: getOverflow(hidden, i18n)
  };
};

export type RewardIconsView = ReturnType<typeof getRewardIconsView>;
