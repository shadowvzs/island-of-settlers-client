/**
 * Military spatial grid (docs/archive/dated/battle-ai-plan-2026-10-12.md, section 3): every fighting soldier
 * sorted into 2-tile cells once per tick by a counting sort, so target and neighbour queries scan
 * a few cells instead of every soldier. Pure and renderer free; the arrays are reused between
 * ticks and only grow, so a rebuild allocates nothing once the battle has reached its size.
 * Order is deterministic: cell order, then insertion order (callers insert by uid).
 */
export interface MilitaryGridPoint { x: number; z: number }

/** Cell side in tiles. */
const CELL_SIZE = 2;
/** Entries are sorted by the cell they stood in when the grid was built; they may have moved since. */
const DRIFT_PAD = .5;

export const createMilitarySpatialGrid = <Entry extends MilitaryGridPoint>(cellsX: number, cellsZ: number) => {
  const columns = Math.max(1, Math.ceil(cellsX / CELL_SIZE)), rows = Math.max(1, Math.ceil(cellsZ / CELL_SIZE));
  /** `starts[cell]` .. `starts[cell + 1]` index `sorted` (the entries of that cell). */
  const starts = new Uint32Array(columns * rows + 1);
  const cursor = new Uint32Array(starts.length);
  let cellOf = new Uint32Array(64), sorted: Entry[] = [], count = 0;
  const cellIndex = (x: number, z: number) => {
    const column = Math.min(columns - 1, Math.max(0, Math.floor(x / CELL_SIZE)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor(z / CELL_SIZE)));
    return row * columns + column;
  };
  /** Sorts `entries` into their cells (counting sort, stable). */
  const rebuild = (entries: readonly Entry[]) => {
    count = entries.length;
    if (cellOf.length < count) cellOf = new Uint32Array(Math.max(count, cellOf.length * 2));
    if (sorted.length < count) sorted = new Array<Entry>(Math.max(count, sorted.length * 2));
    starts.fill(0);
    for (let index = 0; index < count; index++) {
      const cell = cellIndex(entries[index]!.x, entries[index]!.z);
      cellOf[index] = cell; starts[cell + 1]!++;
    }
    for (let cell = 0; cell < columns * rows; cell++) starts[cell + 1]! += starts[cell]!;
    cursor.set(starts);
    for (let index = 0; index < count; index++) sorted[cursor[cellOf[index]!]!++] = entries[index]!;
  };
  /** Calls `visit` for every entry in the cells covering the circle; it returns true to stop early. */
  const scan = (x: number, z: number, radius: number, visit: (entry: Entry) => boolean | void) => {
    const reach = radius + DRIFT_PAD;
    const minColumn = Math.max(0, Math.floor((x - reach) / CELL_SIZE));
    const maxColumn = Math.min(columns - 1, Math.floor((x + reach) / CELL_SIZE));
    const minRow = Math.max(0, Math.floor((z - reach) / CELL_SIZE));
    const maxRow = Math.min(rows - 1, Math.floor((z + reach) / CELL_SIZE));
    for (let row = minRow; row <= maxRow; row++) for (let column = minColumn; column <= maxColumn; column++) {
      const cell = row * columns + column;
      for (let index = starts[cell]!; index < starts[cell + 1]!; index++) if (visit(sorted[index]!)) return;
    }
  };
  /** Every accepted entry within `radius` of the point (exact distance on the live position). */
  const forEachWithin = (
    x: number, z: number, radius: number, accept: (entry: Entry) => boolean, visit: (entry: Entry) => void
  ) => {
    const radiusSquared = radius * radius;
    scan(x, z, radius, entry => {
      const dx = entry.x - x, dz = entry.z - z;
      if (dx * dx + dz * dz <= radiusSquared && accept(entry)) visit(entry);
    });
  };
  /** The nearest accepted entry within `radius`, or undefined. Ties keep the first in grid order. */
  const nearest = (x: number, z: number, radius: number, accept: (entry: Entry) => boolean) => {
    let best: Entry | undefined, bestDistance = radius * radius;
    scan(x, z, radius, entry => {
      const dx = entry.x - x, dz = entry.z - z;
      const distance = dx * dx + dz * dz;
      if (distance <= bestDistance && (distance < bestDistance || !best) && accept(entry)) {
        best = entry; bestDistance = distance;
      }
    });
    return best;
  };
  /** True when an accepted entry stands within `radius`. */
  const anyWithin = (x: number, z: number, radius: number, accept: (entry: Entry) => boolean) => {
    let found = false;
    const radiusSquared = radius * radius;
    scan(x, z, radius, entry => {
      const dx = entry.x - x, dz = entry.z - z;
      found = dx * dx + dz * dz <= radiusSquared && accept(entry);
      return found;
    });
    return found;
  };
  return { anyWithin, forEachWithin, nearest, rebuild, size: () => count };
};

export type MilitarySpatialGrid<Entry extends MilitaryGridPoint> =
  ReturnType<typeof createMilitarySpatialGrid<Entry>>;
