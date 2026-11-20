import type { PlayerInventory, PlayerItemId } from "../../shared/progression/player-inventory";
import type { MapScenario } from "../../shared/world/map-scenario";
import { inventoryItemTab, isInventoryTabEnabled } from "./categories";

export type InventoryMapKind = MapScenario["kind"];
interface MapMetadata {
  adventure?: unknown;
  colony?: unknown;
  scenarioKind?: InventoryMapKind;
}
/** Runtime expedition state and authored map metadata, independent of buildings/ownership. */
export const inventoryMapKind = ({ adventure, colony, scenarioKind }: MapMetadata): InventoryMapKind => {
  if (adventure) return "adventure";
  if (colony) return "colony";
  return scenarioKind ?? "home";
};
export const isInventoryItemVisible = (item: PlayerItemId, kind: InventoryMapKind) =>
  isInventoryTabEnabled(inventoryItemTab(item), kind);

/** Filtering changes only this view; canonical custody/counts are never rewritten. */
export const visiblePlayerInventory = (inventory: PlayerInventory, kind: InventoryMapKind): PlayerInventory => {
  if (kind === "home") return inventory;
  return Object.fromEntries(Object.entries(inventory).filter(([id]) =>
    isInventoryItemVisible(id as PlayerItemId, kind))) as PlayerInventory;
};
