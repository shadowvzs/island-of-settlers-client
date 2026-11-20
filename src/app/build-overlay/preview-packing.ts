/** The fit spots of the selected building: 1 per valid top-left cell, and the plot size. */
export interface FitSpots {
  depth: number;
  marks: Uint8Array;
  width: number;
}

type Point = { x: number; z: number };

export interface PreviewPacking {
  /** Most previews chosen. */
  cap: number;
  cellsX: number;
  /** Cells kept free between two previews (0: plots may touch). */
  gap: number;
  /** The camera centre: the plots nearest it are chosen first. */
  focus: Point;
  spots: FitSpots;
  /** The ground the camera shows (a convex quad, see `getViewOutline`). */
  view: readonly Point[];
}

/** Reused scratch buffers of the packing (grown, never shrunk). */
export interface PackingScratch {
  /** Sort keys: squared distance (quarter cells) times the cell count, plus the cell. */
  keys: Float64Array;
}

export const createPackingScratch = (): PackingScratch => ({ keys: new Float64Array(1024) });

/** Sign of the turn from a to b to the point: the view quad is convex, so one sign means inside. */
const turn = (a: Point, b: Point, x: number, z: number) => (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);

export const isInsideQuad = (quad: readonly Point[], x: number, z: number) => {
  let positive = false, negative = false;
  for (let index = 0; index < quad.length; index++) {
    const side = turn(quad[index]!, quad[(index + 1) % quad.length]!, x, z);
    positive ||= side > 0;
    negative ||= side < 0;
  }
  return !(positive && negative);
};

/** Cell rectangle of the view quad, clamped to the marked grid. */
const viewCellRange = (packing: PreviewPacking) => {
  const { cellsX, spots, view } = packing;
  const cellsZ = spots.marks.length / cellsX;
  let maxX = -Infinity, maxZ = -Infinity, minX = Infinity, minZ = Infinity;
  for (const { x, z } of view) {
    maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z); minX = Math.min(minX, x); minZ = Math.min(minZ, z);
  }
  return {
    maxX: Math.min(cellsX - 1, Math.ceil(maxX)), maxZ: Math.min(cellsZ - 1, Math.ceil(maxZ)),
    minX: Math.max(0, Math.floor(minX - spots.width)), minZ: Math.max(0, Math.floor(minZ - spots.depth))
  };
};

/** Sort keys of the fit spots whose plot centre lies in view, nearest the focus first after sorting. */
const collectVisible = (packing: PreviewPacking, scratch: PackingScratch) => {
  const { cellsX, focus, spots, view } = packing;
  const { maxX, maxZ, minX, minZ } = viewCellRange(packing);
  const cells = spots.marks.length;
  let count = 0;
  for (let z = minZ; z <= maxZ; z++)
    for (let x = minX; x <= maxX; x++) {
      const cell = z * cellsX + x;
      if (!spots.marks[cell]) continue;
      const centreX = x + spots.width / 2, centreZ = z + spots.depth / 2;
      if (!isInsideQuad(view, centreX, centreZ)) continue;
      if (count >= scratch.keys.length) scratch.keys = growKeys(scratch.keys);
      const distance = Math.round(((centreX - focus.x) ** 2 + (centreZ - focus.z) ** 2) * 4);
      scratch.keys[count++] = distance * cells + cell;
    }
  return scratch.keys.subarray(0, count).sort();
};

const growKeys = (keys: Float64Array) => {
  const grown = new Float64Array(keys.length * 2);
  grown.set(keys);
  return grown;
};

/** True when two equally sized plots (top-left cells) come closer than `gap` cells. */
export const plotsOverlap = (spots: Omit<FitSpots, "marks">, first: Point, second: Point, gap = 0) =>
  Math.abs(first.x - second.x) < spots.width + gap && Math.abs(first.z - second.z) < spots.depth + gap;

/** True when the plot at top-left (x, z) keeps `gap` cells from every chosen plot. */
const isClear = (packing: PreviewPacking, chosen: Int32Array, count: number, plot: Point) => {
  const { cellsX, gap, spots } = packing, other = { x: 0, z: 0 };
  for (let index = 0; index < count; index++) {
    other.x = chosen[index]! % cellsX;
    other.z = (chosen[index]! - other.x) / cellsX;
    if (plotsOverlap(spots, plot, other, gap)) return false;
  }
  return true;
};

/**
 * Greedy packing of the preview ghosts: of the valid plots in view, nearest the camera centre
 * first, take every plot that keeps `gap` cells from the plots already taken, up to `cap`. Writes
 * the chosen top-left cells into `chosen` and returns how many. Allocation free once the scratch
 * buffer is large enough.
 */
export const packPreviewPlots = (packing: PreviewPacking, chosen: Int32Array, scratch: PackingScratch) => {
  const keys = collectVisible(packing, scratch);
  const cells = packing.spots.marks.length, limit = Math.min(packing.cap, chosen.length);
  const plot = { x: 0, z: 0 };
  let count = 0;
  for (let index = 0; index < keys.length && count < limit; index++) {
    const cell = keys[index]! % cells;
    plot.x = cell % packing.cellsX;
    plot.z = (cell - plot.x) / packing.cellsX;
    if (isClear(packing, chosen, count, plot)) chosen[count++] = cell;
  }
  return count;
};
