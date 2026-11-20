import { type CellRegion,getCellsRegion } from "../grid-geometry";
import { ORE, type WorldData } from "../world-data";

export interface OreQuantitySummary {
  id: number;
  ore: number;
  cells: number;
  total: number;
  minimum: number;
  maximum: number;
}

/** One map pass, rather than a separate scan per deposit; empty/barren zone records stay hidden. */
export const listOreQuantities = (world: WorldData): OreQuantitySummary[] => {
  const summaries = new Map(world.mineZones.filter(zone => zone.ore !== ORE.none)
    .map(zone => [zone.id, { id: zone.id, ore: zone.ore, cells: 0, total: 0, minimum: 255, maximum: 0 }]));
  for (let cell = 0; cell < world.mineZone.length; cell++) {
    const summary = summaries.get(world.mineZone[cell]!); if (!summary) continue;
    const amount = world.oreAmount[cell]!;
    summary.cells++; summary.total += amount;
    summary.minimum = Math.min(summary.minimum, amount); summary.maximum = Math.max(summary.maximum, amount);
  }
  return [...summaries.values()].filter(summary => summary.cells > 0);
};

/** Exact authored quantity; total remainders go to the first cells in stable row-major order. */
export const setOreZoneQuantity = (
  world: WorldData, id: number, amount: number, mode: "per-cell" | "total"
): { cells: CellRegion; total: number; changedCells: number } | null => {
  const zone = world.mineZones.find(zone => zone.id === id);
  if (!zone || zone.ore === ORE.none || !Number.isSafeInteger(amount) || amount < 0 ||
    !["per-cell", "total"].includes(mode)) return null;
  const cells: number[] = [];
  for (let cell = 0; cell < world.mineZone.length; cell++) if (world.mineZone[cell] === id) cells.push(cell);
  if (!cells.length || amount > (mode === "per-cell" ? 255 : cells.length * 255)) return null;
  const total = mode === "per-cell" ? amount * cells.length : amount;
  const perCell = Math.floor(total / cells.length), remainder = total % cells.length;
  let changedCells = 0;
  cells.forEach((cell, index) => {
    const next = perCell + (index < remainder ? 1 : 0);
    if (world.oreAmount[cell] !== next) { world.oreAmount[cell] = next; changedCells++; }
  });
  // Richness describes the new authored core. Identity, ore kind, boundaries and surveys are untouched.
  zone.richness = (perCell + (remainder > 0 ? 1 : 0)) / 255;
  return { cells: getCellsRegion(world, cells), total, changedCells };
};
