import { SITE_CERTAINTY_TICKS } from "../../balance/commander-director";
import { GARRISON_CAPACITIES } from "../../balance/military";
import { strengthFrom } from "./commander-squads";

/**
 * The known-sites ledger (A14 plan §5.3, lane A14-4b): per computer faction, every enemy building it has seen,
 * with when it first and last saw it and the garrison it saw there. Buildings never move, so a record lasts
 * until the building is removed. While a site is in sight its last-seen tick is the current tick (the reader
 * passes `seenNow`); the stored tick is written when the site leaves sight, so standing observers cost nothing.
 */
export interface KnownSite {
  uid: number;
  /** The building type (its kind). */
  type: number;
  /** The plot centre (static). */
  x: number;
  z: number;
  firstKnownTick: number;
  /** Stored last tick in sight; the effective value is the current tick while the site is seen. */
  lastSeenTick: number;
  /** Soldiers seen in the site at its last sighting (−1: never seen inside) and their strength (×100). */
  garrisonSeen: number;
  strengthSeen: number;
}

/** Saved: [viewer, uid, type, x, z, firstKnownTick, lastSeenTick, garrisonSeen, strengthSeen]. */
export type KnownSiteEntry = [number, number, number, number, number, number, number, number, number];

/** A garrison as counted when its site is in sight. */
export interface GarrisonCount { count: number; strength: number }

/** A full-health rank-0 shield soldier (×100): the unit a never-seen garrison is assumed to hold. */
export const REFERENCE_SOLDIER = Math.floor(strengthFrom(1, "shield", 0) * 100);
const PERCENT = 100;

const byNumber = (a: number, b: number) => a - b;
const isCount = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const isFiniteNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value);

/** The type's full garrison (×100), or undefined for a building that holds no garrison. */
const garrisonPrior = (type: number) => {
  const capacity = GARRISON_CAPACITIES[type];
  return capacity === undefined ? undefined : capacity * REFERENCE_SOLDIER;
};

/**
 * The site's defence estimate (×100) at `tick`: what was seen, trusted less with age (integer certainty), the
 * rest assumed at the type's full garrison (plan §6). A garrison never seen counts as full; a building without
 * a garrison slot keeps what was seen.
 */
export const siteDefenceEstimate = (site: KnownSite, tick: number, seenNow: boolean) => {
  const prior = garrisonPrior(site.type);
  if (site.garrisonSeen < 0) return prior ?? 0;
  if (prior === undefined || seenNow) return site.strengthSeen;
  const age = Math.max(0, tick - site.lastSeenTick);
  const certainty = Math.max(0, Math.floor(PERCENT * (SITE_CERTAINTY_TICKS - age) / SITE_CERTAINTY_TICKS));
  return Math.floor((site.strengthSeen * certainty + prior * (PERCENT - certainty)) / PERCENT);
};

export const createKnownSites = () => {
  const ledgers = new Map<number, Map<number, KnownSite>>();
  const ledgerOf = (viewer: number) => {
    let ledger = ledgers.get(viewer);
    if (!ledger) { ledger = new Map(); ledgers.set(viewer, ledger); }
    return ledger;
  };
  const get = (viewer: number, uid: number) => ledgers.get(viewer)?.get(uid);
  /** `viewer` knows at least one site. */
  const has = (viewer: number) => (ledgers.get(viewer)?.size ?? 0) > 0;
  /** A first sighting (or a hit alert from inside it); an already known site keeps its first tick. */
  const discover = (viewer: number, site: { typeId: number; uid: number; x: number; z: number }, tick: number,
    garrison?: GarrisonCount) => {
    const ledger = ledgerOf(viewer);
    if (ledger.has(site.uid)) return;
    ledger.set(site.uid, { firstKnownTick: tick, garrisonSeen: garrison?.count ?? -1, lastSeenTick: tick,
      strengthSeen: garrison?.strength ?? 0, type: site.typeId, uid: site.uid, x: site.x, z: site.z });
  };
  const seeGarrison = (record: KnownSite, garrison: GarrisonCount) => {
    record.garrisonSeen = garrison.count;
    record.strengthSeen = garrison.strength;
  };
  const forget = (uid: number) => {
    for (const ledger of ledgers.values()) ledger.delete(uid);
  };
  /** Sorted entries; `lastSeen` gives each record's effective last-seen tick (the current tick when in sight). */
  const save = (lastSeen: (viewer: number, record: KnownSite) => number) => {
    const out: KnownSiteEntry[] = [];
    for (const viewer of [...ledgers.keys()].sort(byNumber)) {
      const ledger = ledgers.get(viewer)!;
      for (const uid of [...ledger.keys()].sort(byNumber)) {
        const record = ledger.get(uid)!;
        out.push([viewer, uid, record.type, record.x, record.z, record.firstKnownTick, lastSeen(viewer, record),
          record.garrisonSeen, record.strengthSeen]);
      }
    }
    return out;
  };
  const restore = (entries: readonly KnownSiteEntry[]) => {
    ledgers.clear();
    for (const [viewer, uid, type, x, z, firstKnownTick, lastSeenTick, garrisonSeen, strengthSeen] of entries)
      ledgerOf(viewer).set(uid, { firstKnownTick, garrisonSeen, lastSeenTick, strengthSeen, type, uid, x, z });
  };
  const count = () => {
    let total = 0;
    for (const ledger of ledgers.values()) total += ledger.size;
    return total;
  };
  return { count, discover, forget, get, has, restore, save, seeGarrison };
};

export type KnownSites = ReturnType<typeof createKnownSites>;

const isEntry = (entry: unknown) => {
  if (!Array.isArray(entry) || entry.length !== 9) return false;
  const [viewer, uid, type, x, z, first, last, garrison, strength] = entry as unknown[];
  return [viewer, uid, type, first, last, strength].every(isCount) && [x, z].every(isFiniteNumber) &&
    Number.isSafeInteger(garrison) && (garrison as number) >= -1 && (first as number) <= (last as number);
};

/** Null when the saved ledger is well formed: valid entries in ascending (viewer, uid) order, no repeats. */
export const knownSitesSaveError = (entries: unknown) => {
  if (!Array.isArray(entries) || !entries.every(isEntry)) return "Invalid known sites";
  for (let index = 1; index < entries.length; index++) {
    const [viewer, uid] = entries[index] as KnownSiteEntry, [lastViewer, lastUid] = entries[index - 1] as KnownSiteEntry;
    if (viewer < lastViewer || (viewer === lastViewer && uid <= lastUid)) return "Unordered known sites";
  }
  return null;
};
