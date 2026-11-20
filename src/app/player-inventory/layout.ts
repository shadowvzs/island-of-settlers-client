export const INVENTORY_COLUMNS = 8;
export const INVENTORY_VISIBLE_ROWS = 8;
export interface InventorySlot<T extends string> { count: number; id: T }

/** Inventory quantities aggregate by identity: one slot per distinct owned type, not per unit. */
export const createInventorySlots = <T extends string>(inventory: Readonly<Partial<Record<T, number>>>) => {
  const items = Object.entries(inventory).filter((entry): entry is [string, number] =>
    typeof entry[1] === "number" && Number.isSafeInteger(entry[1]) && entry[1] > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const count = Math.max(INVENTORY_COLUMNS * INVENTORY_VISIBLE_ROWS,
    Math.ceil(items.length / INVENTORY_COLUMNS) * INVENTORY_COLUMNS);
  return Array.from({ length: count }, (_, index): InventorySlot<T> | null => {
    const entry = items[index];
    return entry ? { count: entry[1], id: entry[0] as T } : null;
  });
};
