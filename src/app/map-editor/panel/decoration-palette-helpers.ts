import type { I18n, MessageDescriptor } from "@lingui/core";

import {
  getRoadDecorationItem, type RoadDecorationItemId
} from "../../../../../island-of-settlers-shared/src/road-decoration-items";
import { translateLabel, translateMessage } from "../../../shared/i18n/translate";
import {
  type DecorationEntry, listDecorationCategories, NATURAL_DECORATION_CATEGORY
} from "../../../shared/world/editing/decoration-registry";
import { PLANT_ITEM_MESSAGES } from "../../player-inventory/plant-presentation";
import {
  roadDecorationFinishMessage, roadDecorationIconUrl, roadDecorationMessages
} from "../../player-inventory/road-decoration-presentation";
import { DECORATION_SHOP_MESSAGES } from "../../settlement-ui/gem-shop/decoration-messages";
import { decorationMessage } from "../decoration-editor";
import { toGroundDecorationIcon } from "../editor-catalog";
import { getIconSources } from "../editor-icons";
import { editorMessage, MAP_EDITOR_MESSAGES as M } from "../messages";
import type { FieldOption } from "../section-store";

/** The palette tab that shows every category. */
export const ALL_CATEGORIES = "";

/** One icon tile of the palette grid (labels resolved in the active locale). */
export interface PaletteTile {
  category: string;
  detail: string;
  /** Lower-case text the quick filter matches: translated name, detail and English source name. */
  haystack: string;
  icon: { src: string; srcSet?: string } | null;
  id: string;
  /** Short text of the generated placeholder when the icon is missing or fails to load. */
  initials: string;
  label: string;
}

export interface PaletteCategoryTab {
  id: string;
  label: string;
  selected: boolean;
}

const CATEGORY_LABELS: Readonly<Record<string, MessageDescriptor>> = {
  [ALL_CATEGORIES]: M.palette.all,
  [NATURAL_DECORATION_CATEGORY]: M.palette.natural,
  arches: DECORATION_SHOP_MESSAGES.arches,
  columns: DECORATION_SHOP_MESSAGES.columns,
  lanterns: DECORATION_SHOP_MESSAGES.lanterns,
  plants: DECORATION_SHOP_MESSAGES.plants,
  trees: DECORATION_SHOP_MESSAGES.trees
};

/** Category tabs: All first, then every category the registry holds (a new category gets its id as text). */
export const getPaletteCategoryTabs = (active: string, i18n?: I18n): PaletteCategoryTab[] =>
  [ALL_CATEGORIES, ...listDecorationCategories()].map(id => ({
    id, label: CATEGORY_LABELS[id] ? translateMessage(i18n, CATEGORY_LABELS[id]) : id, selected: id === active
  }));

const toInitials = (label: string) => label.split(/\s+/).filter(Boolean).slice(0, 2)
  .map(word => word[0]!.toUpperCase()).join("");

const groundTile = (entry: Extract<DecorationEntry, { source: "ground" }>, i18n?: I18n) => {
  const label = translateLabel(i18n, decorationMessage(entry.propKind) || entry.name);
  const sources = getIconSources(toGroundDecorationIcon(entry.name));
  return { detail: "", icon: sources && { src: sources.src, srcSet: sources.srcset }, label };
};

/** A plant's form and pot (its structural variant is the variant choice), or empty for other models. */
const plantDetail = (item: RoadDecorationItemId, i18n?: I18n) => {
  const plant = getRoadDecorationItem(item)?.plant;
  if (!plant) return "";
  const form = plant.form === "standalone" ? PLANT_ITEM_MESSAGES.natural : PLANT_ITEM_MESSAGES.compact;
  const parts = [translateMessage(i18n, form)];
  if (plant.potted) parts.push(translateMessage(i18n, PLANT_ITEM_MESSAGES.pot));
  return parts.join(" · ");
};

const placedTile = (entry: Extract<DecorationEntry, { source: "placed" }>, i18n?: I18n) => {
  const item = entry.items[0]!;
  const name = roadDecorationMessages(item)?.name;
  const label = name ? translateMessage(i18n, name) : entry.name;
  return { detail: plantDetail(item, i18n), icon: { src: roadDecorationIconUrl(item) }, label };
};

/** A registry entry as a palette tile. */
export const toPaletteTile = (entry: DecorationEntry, i18n?: I18n): PaletteTile => {
  const { detail, icon, label } = entry.source === "ground" ? groundTile(entry, i18n) : placedTile(entry, i18n);
  return {
    category: entry.category, detail, haystack: `${label} ${detail} ${entry.name}`.toLowerCase(), icon,
    id: entry.id, initials: toInitials(label), label
  };
};

/** Tiles of the active category whose text contains every word of the search. */
export const filterPaletteTiles = (tiles: readonly PaletteTile[], category: string, search: string) => {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return tiles.filter(tile => (category === ALL_CATEGORIES || tile.category === category) &&
    words.every(word => tile.haystack.includes(word)));
};

const variantLabel = (item: RoadDecorationItemId, i18n?: I18n) => {
  const finish = roadDecorationFinishMessage(item);
  if (finish) return translateMessage(i18n, finish);
  const plant = getRoadDecorationItem(item)?.plant;
  return translateMessage(i18n, PLANT_ITEM_MESSAGES.variant, { number: (plant?.variant ?? 0) + 1 });
};

/** The finish / structural variant choices of a decoration model (empty: no variant choice). */
export const getVariantOptions = (entry: DecorationEntry | undefined, i18n?: I18n): FieldOption[] => {
  if (entry?.source !== "placed" || entry.items.length < 2) return [];
  return entry.items.map(item => ({ label: variantLabel(item, i18n), value: item }));
};

/** A tile's tooltip / accessible name: its name and, for plants, form and pot. */
export const getTileTitle = (tile: Pick<PaletteTile, "detail" | "label">) =>
  (tile.detail ? `${tile.label} (${tile.detail})` : tile.label);

/** Grid rows: a failed icon falls back to the generated initials; the selected tile is pressed (aria). */
export const toPaletteRows = (tiles: readonly PaletteTile[], selected: string, failed: ReadonlySet<string>) =>
  tiles.map(tile => ({
    ...tile,
    icon: failed.has(tile.id) ? null : tile.icon,
    selected: tile.id === selected,
    title: getTileTitle(tile)
  }));

/** The palette status line: shown tiles and the authored decoration models (with refused rows). */
export const getPaletteStatus = (shown: number, total: number, placed: number, blocked: number) => {
  const descriptor = blocked > 0 ? M.palette.statusBlocked : M.palette.status;
  return editorMessage(descriptor, { blocked, placed, shown, total });
};
