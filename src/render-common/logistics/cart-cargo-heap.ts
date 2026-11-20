import { cartCapacityFor } from "./handcart-rules";

/**
 * How a hand cart's load is drawn (TALENT-01 handcart talent): `base` within the audited bed layout,
 * `heaped` when talent-raised extra items ride on a top layer, `full` when that raised capacity is
 * reached: the heap is tied down with ropes so a full cart reads as full.
 */
export type CartLoadVariant = "base" | "heaped" | "full";

/** Chosen when a cart's load changes (never per frame): `bonus` is the handcart talent's share. */
export const cartLoadVariant = (ware: string | null, count: number, bonus: number): CartLoadVariant => {
  if (!ware) return "base";
  const base = cartCapacityFor(ware);
  if (count <= base) return "base";
  return count >= cartCapacityFor(ware, bonus) ? "full" : "heaped";
};

/** A bed slot of the audited layout: column across the bed, row along it, layer up from the bed. */
export interface CartSlot { column: number; layer: number; row: number }
interface SlotGrid { columns: number; layers: number; rows: number }

/** The grid's top-layer slots, centre first, so a few extra items heap up in the middle of the bed. */
const centreFirstSlots = ({ columns, rows }: SlotGrid) => {
  const slots: { column: number; row: number }[] = [];
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) slots.push({ column, row });
  const distance = (slot: { column: number; row: number }) =>
    Math.hypot(slot.column - (columns - 1) / 2, slot.row - (rows - 1) / 2);
  return slots.sort((a, b) => distance(a) - distance(b) || a.row - b.row || a.column - b.column);
};

/**
 * Slot of item `index` of a heaped load: the first `columns × rows × layers` items fill the audited
 * layout as usual; the extra ones lie on one more layer on top, from the middle outwards.
 */
export const cartHeapSlot = (grid: SlotGrid, index: number): CartSlot => {
  const layerSize = grid.columns * grid.rows, base = layerSize * grid.layers;
  if (index < base) {
    const slot = index % layerSize;
    return { column: slot % grid.columns, layer: Math.floor(index / layerSize), row: Math.floor(slot / grid.columns) };
  }
  const extra = centreFirstSlots(grid)[(index - base) % layerSize]!;
  return { ...extra, layer: grid.layers + Math.floor((index - base) / layerSize) };
};
