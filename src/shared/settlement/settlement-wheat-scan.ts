import type { FarmAreaBounds } from "./settlement-farm-area";

/** A waiting farm checks this share of its area's rows per work search (about one second apart). */
export const WHEAT_SCAN_BANDS = 4;

interface RowRange { maxZ: number; minZ: number }

/**
 * Sowing-plot search of a wheat farm (LOG-02). While its area has free plots the farm scans every row, so it
 * still plans the nearest batch. Once a full scan finds none ("Waiting for a clear sowing plot") it scans one
 * band of rows per search, in turn, until a band finds a plot again; then the next search is a full one.
 */
export const createWheatScanRotation = () => {
  /** Next band to scan per farm uid; absent while the farm scans its whole area. */
  const cursors = new Map<number, number>();
  const bandHeight = (area: FarmAreaBounds) => Math.ceil((area.maxZ - area.minZ + 1) / WHEAT_SCAN_BANDS);
  /** The rows to scan in this search. */
  const rows = (uid: number, area: FarmAreaBounds): RowRange => {
    const cursor = cursors.get(uid);
    if (cursor === undefined) return { maxZ: area.maxZ, minZ: area.minZ };
    const minZ = area.minZ + cursor * bandHeight(area);
    return { maxZ: Math.min(area.maxZ, minZ + bandHeight(area) - 1), minZ };
  };
  /**
   * Records the search: true when a band found plots, so the caller rescans the whole area at once for the
   * nearest batch.
   */
  const finish = (uid: number, found: boolean) => {
    const cursor = cursors.get(uid);
    if (cursor === undefined) {
      if (!found) cursors.set(uid, 0);
      return false;
    }
    if (found) { cursors.delete(uid); return true; }
    cursors.set(uid, (cursor + 1) % WHEAT_SCAN_BANDS);
    return false;
  };
  /** A load forgets the bands: a resumed island starts every farm with a full scan. */
  const clear = () => cursors.clear();
  return { clear, finish, rows };
};
