import type { CellRegion } from "../../../shared/world/grid-geometry";
import { CRITTER_COLONIES } from "../critter-colonies";
import type { CritterSite, CritterSites } from "../habitat/critter-sites";
import type { CritterTerrain } from "../habitat/critter-terrain";
import type { ClimbableTrees } from "../habitat/critter-trees";
import type { CritterPool } from "./critter-pool";

/** Most members of one site (pool slots kept per site). */
export const MAX_MEMBERS = 8;
/** A homeless critter still in view fades out after this long (seconds). */
const HOMELESS_SECONDS = 12;
/** First value of a homeless timer (any value above 0 marks it). */
const HOMELESS_START = 1e-3;
/** A home a map edit took scares its members off this far beyond the colony's range. */
const RETIRE_SCARE = 2;

/** What the manager keeps per site: its members' pool slots, when it may be occupied again. */
export interface SiteState {
  /** A site whose critter flew off stays empty until this time (seconds). */
  awayUntil: Float32Array;
  occupied: Uint8Array;
  /** Pool slot per member (site * MAX_MEMBERS + member), -1 when none. */
  slots: Int16Array;
}

export const createSiteState = (count: number): SiteState => ({
  awayUntil: new Float32Array(count),
  occupied: new Uint8Array(count),
  slots: new Int16Array(count * MAX_MEMBERS).fill(-1)
});

/** A site's home is the same after an edit when its colony and vertex are. */
const getSiteKey = (site: CritterSite) => `${site.colony}:${site.x}:${site.z}`;

const hasMembers = (state: SiteState, site: number) =>
  state.slots.subarray(site * MAX_MEMBERS, (site + 1) * MAX_MEMBERS).some((slot) => slot >= 0);

/** Frees a critter's member slot of its site (no longer occupied once every slot is free). */
export const leaveSiteSlot = (state: SiteState, pool: CritterPool, index: number) => {
  const site = pool.site[index]!;
  if (site < 0) return;
  state.slots[site * MAX_MEMBERS + pool.member[index]!] = -1;
  pool.site[index] = -1;
  if (!hasMembers(state, site)) state.occupied[site] = 0;
};

/** The site's members lose their home (they leave, see `updateHomeless`). */
const makeHomeless = (state: SiteState, pool: CritterPool, site: number) => {
  for (let member = 0; member < MAX_MEMBERS; member += 1) {
    const slot = state.slots[site * MAX_MEMBERS + member]!;
    if (slot >= 0 && pool.homeless[slot] === 0) pool.homeless[slot] = HOMELESS_START;
  }
};

/** New index of every old site (-1 gone); homes that went but still have members are kept. */
const mapSites = (
  before: readonly CritterSite[],
  after: CritterSite[],
  state: SiteState,
  onRetired: (site: CritterSite, old: number) => void
) => {
  const next = new Map(after.map((site, index) => [getSiteKey(site), index]));
  const mapping = new Int32Array(before.length).fill(-1);
  before.forEach((site, old) => {
    const index = site.retired ? undefined : next.get(getSiteKey(site));
    if (index !== undefined) {
      mapping[old] = index;
      return;
    }
    if (!hasMembers(state, old)) return;
    mapping[old] = after.length;
    after.push(site.retired ? site : { ...site, retired: true });
    if (!site.retired) onRetired(site, old);
  });
  return mapping;
};

/** The state of the new site list: every kept site's members, timers and occupation. */
const moveState = (state: SiteState, mapping: Int32Array, count: number) => {
  const moved = createSiteState(count);
  mapping.forEach((index, old) => {
    if (index < 0) return;
    moved.awayUntil[index] = state.awayUntil[old]!;
    moved.occupied[index] = state.occupied[old]!;
    const from = old * MAX_MEMBERS;
    moved.slots.set(state.slots.subarray(from, from + MAX_MEMBERS), index * MAX_MEMBERS);
  });
  return moved;
};

/**
 * After a map edit replaced the site list (`after`): the kept homes carry their members over,
 * homes that went but still have members stay at the end of the list as retired (never occupied
 * again) and their members become homeless; `onRetired` hears each newly retired home. Returns
 * the state of the new list (the pool's site indices are moved to it).
 */
const carryOverSites = (
  before: readonly CritterSite[],
  after: CritterSite[],
  state: SiteState,
  pool: CritterPool,
  onRetired: (site: CritterSite) => void
) => {
  const mapping = mapSites(before, after, state, (site, old) => {
    makeHomeless(state, pool, old);
    onRetired(site);
  });
  for (let index = 0; index < pool.capacity; index += 1) {
    const site = pool.site[index]!;
    if (pool.active[index] === 1 && site >= 0) pool.site[index] = mapping[site]!;
  }
  return moveState(state, mapping, after.length);
};

/** What a map edit's homes refresh works on (the critter manager's parts). */
export interface CritterHomes {
  pool: CritterPool;
  /** Scares the critters around a point (members of a home that went flee or fly off). */
  scare: (x: number, z: number, radius: number) => void;
  sites: CritterSites;
  terrain: CritterTerrain;
  trees: ClimbableTrees | null;
}

/**
 * Map editor: the homes follow the edited cells (after the shared habitat field): the terrain
 * fields and the sites are taken again; the members of a home that went are scared off and leave
 * out of view (see `updateHomeless`). Returns the state of the new site list.
 */
export const refreshCritterHomes = (homes: CritterHomes, state: SiteState, cells: CellRegion) => {
  homes.terrain.refresh(cells);
  homes.trees?.refresh();
  const before = homes.sites.list;
  homes.sites.refresh(cells);
  return carryOverSites(before, homes.sites.list, state, homes.pool, (site) => {
    homes.scare(site.x, site.z, CRITTER_COLONIES[site.colony]!.range + RETIRE_SCARE);
  });
};

/**
 * A homeless critter keeps living until it is out of view, then it leaves (no pop on screen);
 * one that stays in view fades out after a while.
 */
export const updateHomeless = (pool: CritterPool, index: number, step: number, inView: boolean) => {
  if (pool.homeless[index] === 0) return;
  pool.homeless[index] = pool.homeless[index]! + step;
  if (!inView || pool.homeless[index]! > HOMELESS_SECONDS) pool.leaving[index] = 1;
};
