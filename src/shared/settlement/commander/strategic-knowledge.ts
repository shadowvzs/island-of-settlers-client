import { SCOUT_AGE_TICKS } from "../../balance/commander-director";
import { GARRISON_CAPACITIES } from "../../balance/military";
import { type FactionVision, SIGHT_LEAVE } from "../faction-vision";
import { ownerOf } from "../settlement-ownership";
import type { SettlementPoint } from "../settlement-types";
import {
  createKnownSites, type GarrisonCount, type KnownSite, type KnownSiteEntry, siteDefenceEstimate
} from "./known-sites";
import { planHolds, planScoutTrip, type ScoutPlan, type ScoutPlanEntry, scoutRoute } from "./scout-plan";
import { createSectorStaleness, type SectorEntry, type SectorStaleness } from "./sector-staleness";
import { createSiteIndex, type StrategicSite } from "./site-index";

/**
 * What the computer factions know for strategy (A14 plan §5.3, §6, lane A14-4b; owner Q3): the known-sites
 * ledger, the sector staleness and the scout plans. It follows the vision layer's own restamps (the queued sight
 * changes): a disk that appeared may reveal the buildings near it, a disk taken away dates the sectors and sites
 * it covered. Nothing scans the map per tick; a building list change re-buckets the buildings once.
 */
export interface StrategicKnowledgeSources {
  buildings: () => readonly StrategicSite[];
  building: (uid: number) => StrategicSite | undefined;
  /** The soldiers inside a building now (read only while the building is in the viewer's sight). */
  garrison: (uid: number) => GarrisonCount | undefined;
  now: () => number;
  vision: () => FactionVision | undefined;
}

export interface StrategicKnowledgeSave {
  sites?: KnownSiteEntry[];
  sectors?: SectorEntry[];
  scouting?: ScoutPlanEntry[];
}

const byNumber = (a: number, b: number) => a - b;
const NO_GARRISON: GarrisonCount = Object.freeze({ count: 0, strength: 0 });
/** A known garrison building in sight has its garrison recounted on one tick of this many (1 s). */
const GARRISON_REFRESH_TICKS = 20;

/** Whether the integer disk of `radius` around `cell` covers the point's cell (the layer's own disk test). */
const diskCovers = (cell: number, radius: number, cellsX: number, point: SettlementPoint) => {
  const column = cell % cellsX, row = (cell - column) / cellsX;
  const dx = Math.floor(point.x) - column, dz = Math.floor(point.z) - row;
  return dx * dx + dz * dz <= radius * radius;
};

export const createStrategicKnowledge = (sources: StrategicKnowledgeSources) => {
  const sites = createKnownSites(), index = createSiteIndex(sources.buildings);
  const plans = new Map<number, ScoutPlan>();
  const nearby: StrategicSite[] = [], covered: StrategicSite[] = [];
  let sectors: SectorStaleness | undefined, sectorsFor: FactionVision | undefined;
  const sectorsOf = (vision: FactionVision) => {
    if (sectorsFor !== vision) { sectors = createSectorStaleness(vision.cellsX, vision.cellsZ); sectorsFor = vision; }
    return sectors!;
  };
  const layerAt = (viewer: number, cell: number) => sources.vision()?.layer(viewer)?.[cell] ?? 0;
  const seesSite = (vision: FactionVision, viewer: number, site: StrategicSite) =>
    vision.sees(viewer, site.x, site.z) || vision.sees(viewer, site.access.x, site.access.z);
  const isEnemySite = (viewer: number, site: StrategicSite) => ownerOf(site) !== viewer;
  /** The garrison a site shows now: only a garrison building holds one (no census for the others). */
  const garrisonOf = (site: StrategicSite) =>
    GARRISON_CAPACITIES[site.typeId] === undefined ? NO_GARRISON : sources.garrison(site.uid) ?? NO_GARRISON;
  /**
   * `viewer` sees `site` now: a new record, or the garrison of a known garrison building refreshed, at most once
   * per `GARRISON_REFRESH_TICKS` (its slot by uid), so observers moving round a site do not recount it every tick.
   */
  const sight = (viewer: number, site: StrategicSite, tick: number, refresh: boolean) => {
    const record = sites.get(viewer, site.uid);
    if (!record) { sites.discover(viewer, site, tick, garrisonOf(site)); return; }
    if (!refresh || GARRISON_CAPACITIES[site.typeId] === undefined) return;
    if ((tick + site.uid) % GARRISON_REFRESH_TICKS === 0) sites.seeGarrison(record, garrisonOf(site));
  };
  /** The buildings whose centre or entrance the disk covers, in a reused array. */
  const coveredBy = (vision: FactionVision, cell: number, radius: number) => {
    const column = cell % vision.cellsX, row = (cell - column) / vision.cellsX;
    index.near(column, row, radius, nearby);
    covered.length = 0;
    for (const site of nearby)
      if (diskCovers(cell, radius, vision.cellsX, site) || diskCovers(cell, radius, vision.cellsX, site.access))
        covered.push(site);
    return covered;
  };
  const enterDisk = (vision: FactionVision, viewer: number, cell: number, radius: number) => {
    const tick = sources.now();
    for (const site of coveredBy(vision, cell, radius)) if (isEnemySite(viewer, site)) sight(viewer, site, tick, true);
  };
  const leaveDisk = (vision: FactionVision, viewer: number, cell: number, radius: number) => {
    const tick = sources.now();
    sectorsOf(vision).stampDisk(viewer, cell, radius, tick);
    if (!sites.has(viewer)) return;
    for (const site of coveredBy(vision, cell, radius)) {
      const record = sites.get(viewer, site.uid);
      if (record) record.lastSeenTick = tick;
    }
  };
  /** A queue overflow: every computer faction looks at every building once (no sector dating is lost twice). */
  const rescan = (vision: FactionVision) => {
    const tick = sources.now();
    for (const viewer of vision.factions()) {
      if (viewer <= 0) continue;
      for (const site of sources.buildings())
        if (isEnemySite(viewer, site) && seesSite(vision, viewer, site)) sight(viewer, site, tick, true);
    }
  };
  /** Buildings that appeared inside a computer faction's sight are seen at once. */
  const seeNewBuildings = (vision: FactionVision) => {
    const fresh = index.refresh(vision.cellsX, vision.cellsZ);
    if (!fresh.length) return;
    const tick = sources.now();
    for (const viewer of vision.factions()) {
      if (viewer <= 0) continue;
      for (const site of fresh)
        if (isEnemySite(viewer, site) && seesSite(vision, viewer, site)) sight(viewer, site, tick, false);
    }
  };
  /**
   * The end-of-tick knowledge phase: the building index, then this tick's sight changes in queue order. A rebuild
   * queues none: a load restored what was known, and a fresh island's buildings are all new to the index, so
   * `seeNewBuildings` looks at them.
   */
  const observe = () => {
    const vision = sources.vision();
    if (!vision) return;
    seeNewBuildings(vision);
    const complete = vision.drainSightChanges((viewer, cell, radius, kind) => {
      if (kind === SIGHT_LEAVE) leaveDisk(vision, viewer, cell, radius);
      else enterDisk(vision, viewer, cell, radius);
    });
    if (!complete) rescan(vision);
  };
  /** The effective last-seen tick of a record (the current tick while the site is in sight). */
  const lastSeenOf = (viewer: number, record: KnownSite) => {
    const vision = sources.vision(), site = sources.building(record.uid);
    return vision && site && seesSite(vision, viewer, site) ? sources.now() : record.lastSeenTick;
  };
  /** A hit from a soldier inside `uid` reveals the building to `viewer` (its garrison stays unknown). */
  const revealSite = (viewer: number, uid: number) => {
    const site = sources.building(uid);
    if (site && isEnemySite(viewer, site)) sites.discover(viewer, site, sources.now());
  };
  /** The known site's defence estimate (×100) with the plan §6 certainty decay; undefined when unknown. */
  const defence = (viewer: number, uid: number) => {
    const record = sites.get(viewer, uid);
    if (!record) return undefined;
    const tick = sources.now();
    return siteDefenceEstimate(record, tick, lastSeenOf(viewer, record) === tick);
  };
  const sectorLastSeen = (vision: FactionVision, viewer: number, point: SettlementPoint) => {
    const grid = sectorsOf(vision);
    return grid.lastSeen(viewer, grid.sectorOf(point), sources.now(), layerAt);
  };
  /**
   * Up to three places a scout of `viewer` should visit from `from`, in visiting order: the faction's scout plan
   * (start-known `starts` first, then sectors unseen for `scoutAgeTicks`, the viewer's level), kept while its
   * trip runs. No layer: the starts only.
   */
  const scoutGoals = (viewer: number, from: SettlementPoint, starts: readonly SettlementPoint[],
    isClear: (point: SettlementPoint) => boolean, scoutAgeTicks = SCOUT_AGE_TICKS) => {
    const vision = sources.vision();
    if (!vision) return scoutRoute(starts.slice(0, 3), from);
    const grid = sectorsOf(vision), now = sources.now();
    const lastSeen = (point: SettlementPoint) => sectorLastSeen(vision, viewer, point);
    let plan = plans.get(viewer);
    if (!plan || !planHolds(plan, now, lastSeen)) {
      const goals = planScoutTrip({ centreOf: grid.centreOf, isClear, lastSeen, scoutAgeTicks,
        sectorOf: grid.sectorOf, sectorsX: grid.sectorsX, sectorsZ: grid.sectorsZ }, from, starts, now);
      plan = goals.length ? { goals, tick: now } : undefined;
      if (plan) plans.set(viewer, plan); else plans.delete(viewer);
    }
    return plan ? scoutRoute(plan.goals, from) : [];
  };
  const save = (): StrategicKnowledgeSave => {
    const vision = sources.vision(), saved: StrategicKnowledgeSave = {};
    const known = sites.save(lastSeenOf);
    if (known.length) saved.sites = known;
    const seen = vision ? sectorsOf(vision).save(sources.now(), layerAt) : [];
    if (seen.length) saved.sectors = seen;
    const scouting = [...plans.keys()].sort(byNumber).map((viewer): ScoutPlanEntry =>
      [viewer, plans.get(viewer)!.tick, plans.get(viewer)!.goals.map(goal => [goal.x, goal.z])]);
    if (scouting.length) saved.scouting = scouting;
    return saved;
  };
  /** A load; `legacy` = a format ≤ 11 save's seen buildings ([viewer, uid]), known since tick 0. */
  const restore = (saved: StrategicKnowledgeSave | undefined, legacy: readonly [number, number][] = []) => {
    sites.restore(saved?.sites ?? []);
    for (const [viewer, uid] of legacy) {
      const site = sources.building(uid);
      if (site) sites.discover(viewer, site, 0);
    }
    const vision = sources.vision();
    if (vision) sectorsOf(vision).restore(saved?.sectors ?? []);
    plans.clear();
    for (const [viewer, tick, goals] of saved?.scouting ?? [])
      plans.set(viewer, { goals: goals.map(([x, z]) => ({ x, z })), tick });
    index.adopt();
  };
  return {
    defence, forget: sites.forget, observe, revealSite, restore, save, scoutGoals,
    site: sites.get, stats: () => ({ plans: plans.size, sites: sites.count() })
  };
};

export type StrategicKnowledge = ReturnType<typeof createStrategicKnowledge>;
