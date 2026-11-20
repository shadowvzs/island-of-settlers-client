import type { CellRegion } from "../../shared/world/grid-geometry";
import { forEachRegionCell } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { COVER } from "./prop-mesh-layout";

/**
 * Map-editor painted grass (one byte per cell, `WorldData.coverPaint`): 0 keeps the island's own
 * biome mix, 1..6 force one cover kind. Values are independent of the runtime kind bytes so the
 * append-only COVER table never changes a saved map.
 */
const PAINTED_COVER_KINDS: readonly number[] = [
  COVER.savannaGrass,
  COVER.jungleGrass,
  COVER.forestGrass,
  COVER.shortGrass,
  COVER.tallGrass,
  COVER.dryTuft
];

export const getPaintedCoverValue = (kind: number) => PAINTED_COVER_KINDS.indexOf(kind) + 1;

export const getPaintedCoverKind = (world: WorldData, cell: number) => {
  const value = world.coverPaint?.[cell] ?? 0;
  if (value <= 0) return null;
  return PAINTED_COVER_KINDS[value - 1] ?? null;
};

const ensureCoverPaint = (world: WorldData) => {
  world.coverPaint ??= new Uint8Array(world.cellsX * world.cellsZ);
  return world.coverPaint;
};

/** Paints one kind into the accepted cells; returns how many cells changed. */
export const paintCoverCells = (world: WorldData, cells: Iterable<number>, kind: number) => {
  const value = getPaintedCoverValue(kind);
  if (value === 0) return 0;
  const paint = ensureCoverPaint(world);
  let changed = 0;
  for (const cell of cells) {
    if (paint[cell] === value) continue;
    paint[cell] = value;
    changed += 1;
  }
  return changed;
};

/** Clears the painted grass of a region; returns how many cells changed. */
export const clearCoverPaintRegion = (world: WorldData, region: CellRegion) => {
  const paint = world.coverPaint;
  if (!paint) return 0;
  let changed = 0;
  forEachRegionCell(world, region, (cell) => {
    if (paint[cell] === 0) return;
    paint[cell] = 0;
    changed += 1;
  });
  return changed;
};
