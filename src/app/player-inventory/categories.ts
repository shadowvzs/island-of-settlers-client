import type { I18n } from "@lingui/core";
import { itemEntry } from "@shared/catalog";

import { isRoadDecorationItemId } from "../../../../island-of-settlers-shared/src/road-decoration-items";
import { translateMessage } from "../../shared/i18n/translate";
import type { PlayerInventory, PlayerItemId } from "../../shared/progression/player-inventory";
import type { InventoryMapKind } from "./map-context";
import { INVENTORY_MESSAGES as M } from "./messages";

export const INVENTORY_TABS = ["battle", "decoration", "misc"] as const;
export type InventoryTab = typeof INVENTORY_TABS[number];
const ITEM_CATEGORY_PREFIX = "item.";
/** Decorations have their own tab; a personal consumable's catalog category (`item.<tab>`) names its tab. */
export const inventoryItemTab = (item: PlayerItemId): InventoryTab => {
  if (isRoadDecorationItemId(item)) return "decoration";
  return itemEntry(item)?.category.slice(ITEM_CATEGORY_PREFIX.length) as InventoryTab;
};
export const isInventoryTabEnabled = (tab: InventoryTab, kind: InventoryMapKind) =>
  kind === "home" || tab === "battle";
export const activeInventoryTab = (draft: InventoryTab, kind: InventoryMapKind): InventoryTab => {
  if (!isInventoryTabEnabled(draft, kind)) return "battle";
  return draft;
};
export const inventoryForTab = (inventory: PlayerInventory, tab: InventoryTab): PlayerInventory =>
  Object.fromEntries(Object.entries(inventory).filter(([id]) => inventoryItemTab(id as PlayerItemId) === tab));
export const getInventoryTabs = (active: InventoryTab, kind: InventoryMapKind, i18n?: I18n) =>
  INVENTORY_TABS.map(id => ({
    disabled: !isInventoryTabEnabled(id, kind), id,
    label: translateMessage(i18n, M[id]), selected: id === active,
    tabId: `player-inventory-tab-${id}`, tabIndex: id === active ? 0 : -1
  }));
