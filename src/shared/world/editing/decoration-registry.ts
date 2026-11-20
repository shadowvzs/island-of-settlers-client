import {
  isEditorDecorationItem, ROAD_DECORATION_ITEM_DEFINITIONS, type RoadDecorationItemDefinition,
  type RoadDecorationItemId
} from "../../../../../island-of-settlers-shared/src/road-decoration-items";
import { roadDecorationModelReady } from "../../../render-common/road-decoration-readiness";
import { getRoadDecoration } from "../../settlement/road-decoration-catalog";
import { DECORATION_KINDS, decorationScaleLimits } from "./decoration-editing";

/** Natural world props first, then the placed decoration categories in their registry order. */
export const NATURAL_DECORATION_CATEGORY = "natural";
export type DecorationCategory = typeof NATURAL_DECORATION_CATEGORY | RoadDecorationItemDefinition["category"];

interface DecorationEntryBase {
  category: DecorationCategory;
  /** Stable palette key: `ground:<prop kind>` or `placed:<content group>`. */
  id: string;
  /** English source name (search fallback, tests and logs). */
  name: string;
}

/** A natural world prop (stones, shrubs, reeds): free rotation and its model's scale limits. */
export interface GroundDecorationEntry extends DecorationEntryBase {
  propKind: number;
  scale: Readonly<{ max: number; min: number }>;
  source: "ground";
}

/** A placed decoration model (arches, lanterns, columns, ornamental plants): free yaw, item variants. */
export interface PlacedDecorationEntry extends DecorationEntryBase {
  /** Finishes or authored variants of the same model, in registry order (the first is the default). */
  items: readonly RoadDecorationItemId[];
  source: "placed";
}

export type DecorationEntry = GroundDecorationEntry | PlacedDecorationEntry;

const toGroundEntry = ([name, propKind]: typeof DECORATION_KINDS[number]): GroundDecorationEntry => ({
  category: NATURAL_DECORATION_CATEGORY, id: `ground:${propKind}`, name, propKind,
  scale: decorationScaleLimits(propKind), source: "ground"
});

/** Plant items differ only by their trailing structural variant; other models keep their content id. */
const toGroupKey = (item: RoadDecorationItemDefinition) =>
  item.plant ? item.decoration.replace(/-\d$/, "") : item.decoration;

/**
 * Editor-placeable items with a registered, renderable model, whatever their shop availability
 * (building-only uses and staged custody-only IDs without art stay out).
 */
export const isEditorPaletteItem = (item: RoadDecorationItemDefinition) => {
  if (!isEditorDecorationItem(item)) return false;
  const definition = getRoadDecoration(item.decoration);
  return definition !== undefined && roadDecorationModelReady(definition);
};

const toPlacedEntries = () => {
  const groups = new Map<string, { item: RoadDecorationItemDefinition; items: RoadDecorationItemId[] }>();
  for (const [id, item] of Object.entries(ROAD_DECORATION_ITEM_DEFINITIONS)) {
    if (!isEditorPaletteItem(item)) continue;
    const key = toGroupKey(item);
    const group = groups.get(key);
    if (group) group.items.push(id as RoadDecorationItemId);
    else groups.set(key, { item, items: [id as RoadDecorationItemId] });
  }
  return [...groups].map(([key, { item, items }]): PlacedDecorationEntry => ({
    category: item.category, id: `placed:${key}`, items, name: item.name, source: "placed"
  }));
};

let entries: readonly DecorationEntry[] | undefined;

/**
 * Every decoration the map editor can place, derived from the two canonical sources: the natural
 * ground props (`DECORATION_KINDS`) and the decoration item registry (`ROAD_DECORATION_ITEM_DEFINITIONS`).
 * New content registered there appears here without a separate editor list.
 */
export const listDecorationEntries = (): readonly DecorationEntry[] => {
  entries ??= Object.freeze([...DECORATION_KINDS.map(toGroundEntry), ...toPlacedEntries()]);
  return entries;
};

/** Categories present in the registry, natural props first. */
export const listDecorationCategories = (): readonly DecorationCategory[] =>
  [...new Set(listDecorationEntries().map(entry => entry.category))];

export const findDecorationEntry = (id: string) => listDecorationEntries().find(entry => entry.id === id);

/** The palette entry that offers this item (for selecting a placed decoration on the map). */
export const findDecorationEntryForItem = (item: RoadDecorationItemId) => listDecorationEntries()
  .find((entry): entry is PlacedDecorationEntry => entry.source === "placed" && entry.items.includes(item));
