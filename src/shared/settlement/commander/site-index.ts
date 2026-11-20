import { SECTOR_TILES } from "../../balance/commander-director";

/** A building as the strategic knowledge sees it: plot centre, entrance, type and owner (all static). */
export interface StrategicSite {
  uid: number;
  typeId: number;
  x: number;
  z: number;
  access: { x: number; z: number };
  militaryFaction?: number;
}

/** An entrance lies at most this far (tiles) from its plot centre: the bucket search margin. */
const ACCESS_MARGIN = 8;

/**
 * Buildings bucketed by sector (A14-4b) so a sight disk visits only the buildings near it. Membership follows
 * the island's building list cheaply: a change of its length or of its last uid (new buildings append with a
 * higher uid) marks the index stale; it is rebuilt once, and the uids not indexed before are reported as new.
 */
export const createSiteIndex = (buildings: () => readonly StrategicSite[]) => {
  /** Buildings per bucket (row-major over `bucketsX` columns); an unused bucket is undefined. */
  let buckets: (StrategicSite[] | undefined)[] = [];
  let indexed = new Set<number>();
  let length = -1, tail = -1, bucketsX = 0, bucketsZ = 0, stale = true;
  const fresh: StrategicSite[] = [];
  const tailOf = (list: readonly StrategicSite[]) => list.at(-1)?.uid ?? -1;
  const columnOf = (x: number) => Math.min(bucketsX - 1, Math.max(0, Math.floor(x / SECTOR_TILES)));
  const rowOf = (z: number) => Math.min(bucketsZ - 1, Math.max(0, Math.floor(z / SECTOR_TILES)));
  const rebuild = (list: readonly StrategicSite[]) => {
    buckets = [];
    const next = new Set<number>();
    for (const site of list) {
      next.add(site.uid);
      const key = rowOf(site.z) * bucketsX + columnOf(site.x);
      (buckets[key] ??= []).push(site);
    }
    indexed = next;
    stale = false;
  };
  /**
   * Brings the index up to date for a map of `cellsX` × `cellsZ`; returns the buildings that appeared since the
   * last refresh (a reused array; empty when nothing changed).
   */
  const refresh = (cellsX: number, cellsZ: number) => {
    fresh.length = 0;
    const list = buildings(), width = Math.ceil(cellsX / SECTOR_TILES);
    if (!stale && list.length === length && tailOf(list) === tail && width === bucketsX) return fresh;
    for (const site of list) if (!indexed.has(site.uid)) fresh.push(site);
    bucketsX = width; bucketsZ = Math.ceil(cellsZ / SECTOR_TILES); length = list.length; tail = tailOf(list);
    rebuild(list);
    return fresh;
  };
  /** A load: the restored buildings are the known membership (none is new); buckets follow at the next refresh. */
  const adopt = () => {
    const list = buildings();
    indexed = new Set(list.map(site => site.uid));
    length = list.length; tail = tailOf(list); stale = true;
  };
  /** Fills `out` with every indexed building whose centre lies within `radius` + the access margin of (x, z). */
  const near = (x: number, z: number, radius: number, out: StrategicSite[]) => {
    out.length = 0;
    const reach = radius + ACCESS_MARGIN;
    const lastX = columnOf(x + reach), lastZ = rowOf(z + reach);
    for (let bz = rowOf(z - reach); bz <= lastZ; bz++) {
      for (let bx = columnOf(x - reach); bx <= lastX; bx++) {
        const bucket = buckets[bz * bucketsX + bx];
        if (bucket) for (const site of bucket) out.push(site);
      }
    }
  };
  return { adopt, near, refresh };
};
