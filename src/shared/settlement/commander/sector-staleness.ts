import { SECTOR_TILES } from "../../balance/commander-director";
import type { SettlementPoint } from "../settlement-types";

/**
 * Sector staleness (A14 plan §5.3, lane A14-4b): per computer faction, when it last saw each sector of the map
 * (16 × 16 tiles), sampled at the sector's centre cell. A sector whose centre is in sight now was seen now; the
 * stored tick is written when a disk that covered the centre is taken away (an observer moved on, fell or went
 * inside), so the cost follows the vision layer's own restamps, never a scan of the map.
 */
export type SectorEntry = [number, number, number];

/** Reads the faction's vision counter at a cell (0: unseen). */
export type LayerAt = (viewer: number, cell: number) => number;

const byNumber = (a: number, b: number) => a - b;
const isCount = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

export const createSectorStaleness = (cellsX: number, cellsZ: number) => {
  const sectorsX = Math.ceil(cellsX / SECTOR_TILES), sectorsZ = Math.ceil(cellsZ / SECTOR_TILES);
  const size = sectorsX * sectorsZ;
  /** Stored last-seen tick + 1 per sector (0: never seen). */
  const grids = new Map<number, Int32Array>();
  const half = SECTOR_TILES >> 1;
  const centreColumn = (sector: number) => Math.min(cellsX - 1, (sector % sectorsX) * SECTOR_TILES + half);
  const centreRow = (sector: number) =>
    Math.min(cellsZ - 1, Math.floor(sector / sectorsX) * SECTOR_TILES + half);
  const centreCell = (sector: number) => centreRow(sector) * cellsX + centreColumn(sector);
  /** The centre of the sector's centre cell (a walkable goal point). */
  const centreOf = (sector: number): SettlementPoint => ({ x: centreColumn(sector) + .5, z: centreRow(sector) + .5 });
  const sectorOf = (point: SettlementPoint) => {
    const column = Math.min(sectorsX - 1, Math.max(0, Math.floor(point.x / SECTOR_TILES)));
    const row = Math.min(sectorsZ - 1, Math.max(0, Math.floor(point.z / SECTOR_TILES)));
    return row * sectorsX + column;
  };
  const gridOf = (viewer: number) => {
    let grid = grids.get(viewer);
    if (!grid) { grid = new Int32Array(size); grids.set(viewer, grid); }
    return grid;
  };
  /** Sector index range [first, last] of centres within `radius` cells of `cell` along one axis. */
  const span = (cell: number, radius: number, sectors: number) => ({
    first: Math.max(0, Math.ceil((cell - radius - half) / SECTOR_TILES)),
    last: Math.min(sectors - 1, Math.floor((cell + radius - half) / SECTOR_TILES))
  });
  /**
   * A disk of `viewer` (the layer's integer disk: dx² + dz² ≤ r² around `cell`) was taken away at `tick`:
   * every sector centre it covered was seen until then.
   */
  const stampDisk = (viewer: number, cell: number, radius: number, tick: number) => {
    const column = cell % cellsX, row = (cell - column) / cellsX, limit = radius * radius;
    const columns = span(column, radius, sectorsX), rows = span(row, radius, sectorsZ);
    let grid: Int32Array | undefined;
    for (let sz = rows.first; sz <= rows.last; sz++) {
      for (let sx = columns.first; sx <= columns.last; sx++) {
        const sector = sz * sectorsX + sx;
        const dx = centreColumn(sector) - column, dz = centreRow(sector) - row;
        if (dx * dx + dz * dz > limit) continue;
        grid ??= gridOf(viewer);
        grid[sector] = tick + 1;
      }
    }
  };
  /** The effective last tick `viewer` saw the sector (the current tick while its centre is in sight; −1 never). */
  const lastSeen = (viewer: number, sector: number, now: number, layerAt: LayerAt) => {
    if (layerAt(viewer, centreCell(sector)) > 0) return now;
    return (grids.get(viewer)?.[sector] ?? 0) - 1;
  };
  /** Sorted [viewer, sector, effective tick] of every sector a faction has seen (canonical save). */
  const save = (now: number, layerAt: LayerAt) => {
    const out: SectorEntry[] = [];
    for (const viewer of [...grids.keys()].sort(byNumber)) {
      for (let sector = 0; sector < size; sector++) {
        const tick = lastSeen(viewer, sector, now, layerAt);
        if (tick >= 0) out.push([viewer, sector, tick]);
      }
    }
    return out;
  };
  const restore = (entries: readonly SectorEntry[]) => {
    grids.clear();
    for (const [viewer, sector, tick] of entries) if (sector < size) gridOf(viewer)[sector] = tick + 1;
  };
  return { centreOf, lastSeen, restore, save, sectorOf, sectorsX, sectorsZ, size, stampDisk };
};

export type SectorStaleness = ReturnType<typeof createSectorStaleness>;

/** Null when the saved sectors are well formed: counts in ascending (viewer, sector) order, no repeats. */
export const sectorStalenessSaveError = (entries: unknown) => {
  const valid = (entry: unknown) => Array.isArray(entry) && entry.length === 3 && entry.every(isCount);
  if (!Array.isArray(entries) || !entries.every(valid)) return "Invalid sector staleness";
  for (let index = 1; index < entries.length; index++) {
    const [viewer, sector] = entries[index] as SectorEntry, [lastViewer, lastSector] = entries[index - 1] as SectorEntry;
    if (viewer < lastViewer || (viewer === lastViewer && sector <= lastSector)) return "Unordered sector staleness";
  }
  return null;
};
