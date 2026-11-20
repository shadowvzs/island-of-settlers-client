import { DMath } from "../math/deterministic-math";
import { featureState } from "./feature-rules";
import {
  type ChartedSite, chartedSiteFootprintCells, chartedSiteMatchesMap, chartedSiteObserved, type ChartedSitesSave,
  cloneChartedSite, type ExplorationMode, MAX_CHARTED_SITES
} from "./settlement-charted-sites";
import { type AnchoredSite, createChartingCandidates } from "./settlement-charting-candidates";
import { findHomeBuilding, isOwnBuilding } from "./settlement-home";
import { landmassAt, landmassCount } from "./settlement-landmass-index";
import type { NavalExpedition } from "./settlement-naval-fleet";
import { ownerOf } from "./settlement-ownership";
import { findCoastalWorkSite } from "./settlement-sea-navigation";
import { createShipRoutePlanner } from "./settlement-ship-routes";
import type { SettlementContext, SettlementPoint } from "./settlement-types";
import { rulesOf } from "./sim-rules";
import { territoryRadius } from "./workshop-upgrades";

const HARBOUR_TYPE = 39;
const OBSERVATION_POINTS = 4;
const ROUTE_LIMIT = 240;
const POINT_SEPARATION = 24;

export interface ChartingShip {
  phase: string;
  /** Held for another founding/scout preparation: never available to a second operation. */
  reservedFor?: number;
  visitor?: boolean;
  x: number;
  z: number;
}
export interface ChartingHooks {
  active(sourceUid: number): boolean;
  claimed(point: { x: number; z: number; rotation: number }): boolean;
  idleShips(): readonly ChartingShip[];
  mode?: ExplorationMode;
  pendingOrders(): number;
  /** The route a ship can sail, or null when no safe route exists. */
  route?: (from: SettlementPoint, to: SettlementPoint) => readonly SettlementPoint[] | null;
  scoutSupply(sourceUid: number): { settlers: number; spyglasses: number };
  site(point: { x: number; z: number; rotation: number }): NavalExpedition | null;
  /** Override only where the caller already owns a validated departure water point. */
  sourceWater?: (sourceUid: number) => SettlementPoint | null;
}
export type ScoutingAvailabilityReason =
  "active" | "featureOff" | "harbour" | "landmasses" | "noFog" | "noSites" | "notHomeMap" | "scout" | "ship" |
  "spyglass";
export interface ScoutingAvailability {
  hidden: boolean;
  ready: boolean;
  reason?: ScoutingAvailabilityReason;
}
export type ChartedSiteReason =
  "available" | "claimed" | "foreign" | "invalid" | "occupied" | "owned" | "unreachable" | "unobserved" | "wrongMap";
export interface ChartedSiteStatus {
  available: boolean;
  reason: ChartedSiteReason;
  site: ChartedSite;
  target?: NavalExpedition;
}
const pointLength = (from: SettlementPoint, path: readonly SettlementPoint[]) => {
  let length = 0, previous = from;
  for (const point of path) {
    length += DMath.hypot(point.x - previous.x, point.z - previous.z);
    previous = point;
  }
  return length;
};

const completedHarbour = (context: SettlementContext, uid: number) =>
  context.buildings.find(building => building.uid === uid && building.typeId === HARBOUR_TYPE &&
    building.construction === 1 && isOwnBuilding(building));

/**
 * Player-specific charted harbour sites and the scouting availability derived from them. The service
 * never charts from presentation fog, camera position or temporary sight: only `world.fog` (real
 * player knowledge) and a scout observation callback are accepted.
 */
export const createNavalCharting = (context: SettlementContext, sea: Uint8Array, hooks: ChartingHooks) => {
  const { world } = context.options;
  let plannerRevision = world.terrainRevision ?? 0;
  let navigation = createShipRoutePlanner(world, sea);
  const planner = () => {
    if ((world.terrainRevision ?? 0) === plannerRevision) return navigation;
    plannerRevision = world.terrainRevision ?? 0;
    navigation = createShipRoutePlanner(world, sea);
    sourceWaters.clear();
    return navigation;
  };
  const defaultRoute = (from: SettlementPoint, to: SettlementPoint) => planner().route({ ...from, yaw: 0 }, to);
  const route = hooks.route ?? defaultRoute;
  const candidates = createChartingCandidates(context, sea, hooks.site);
  const sourceWaters = new Map<string, SettlementPoint | null>();
  let sites: ChartedSite[] = [];
  /** The saved gameplay mode (today's field); fog of war off in the island's rules overrides it (GS4a). */
  let savedMode: ExplorationMode = hooks.mode ?? "fog";
  const currentMode = (): ExplorationMode => rulesOf(context).fogOfWar ? savedMode : "revealed";
  let sightRevision = "";

  /**
   * Discovery changes only when a hidden cell is explored (live sight alone never charts a new site). Builds, roads and levelled ground can
   * invalidate a site, but they cannot reveal a new one; usability is validated on demand instead.
   * Including those revisions here rebuilt every harbour candidate on the tick after a building
   * was placed (the multi-second debug-build freeze).
   */
  const currentSightRevision = () => String(world.exploredRevision ?? 0);
  const candidateSites = () => {
    planner();
    return candidates.list();
  };
  /** Fog observation reuses the topology-matched anchor list; it never needs fresh dock proofs. */
  const observationSites = () => {
    planner();
    return candidates.observe();
  };

  const ownLandmasses = () => {
    const result = new Set<number>();
    for (const building of context.buildings) {
      if (!isOwnBuilding(building)) continue;
      const id = landmassAt(world, building);
      if (id >= 0) result.add(id);
    }
    return result;
  };

  const foreignTerritory = (site: Pick<ChartedSite, "x" | "z">) => context.buildings.some(building => {
    if (ownerOf(building) <= 0) return false;
    const radius = territoryRadius(building) ?? 0;
    const reach = radius + Math.max(building.width, building.depth) / 2 + 2;
    return DMath.hypot(site.x - building.x, site.z - building.z) <= reach;
  });

  const asSite = (candidate: AnchoredSite): ChartedSite => ({
    geometryRevision: world.terrainRevision ?? 0,
    map: { cellsX: world.cellsX, cellsZ: world.cellsZ, seed: world.seed },
    rotation: candidate.rotation,
    rotations: candidate.rotations.slice(),
    water: { ...candidate.water },
    x: candidate.x,
    z: candidate.z
  });

  const isCharted = (candidate: Pick<ChartedSite, "x" | "z">) =>
    sites.some(site => site.x === candidate.x && site.z === candidate.z);

  const addCharted = (candidate: AnchoredSite) => {
    const existing = sites.find(site => site.x === candidate.x && site.z === candidate.z);
    if (existing) {
      existing.rotations = [...new Set([...existing.rotations, ...candidate.rotations])].sort((a, b) => a - b);
      existing.water = { ...candidate.water };
      existing.geometryRevision = world.terrainRevision ?? 0;
      return;
    }
    if (sites.length >= MAX_CHARTED_SITES) return;
    sites.push(asSite(candidate));
  };

  const refreshSight = () => {
    // Nothing is charted while fog of war is off: every stored harbour spot is already a target.
    if (currentMode() === "revealed") return;
    const revision = currentSightRevision();
    if (revision === sightRevision) return;
    sightRevision = revision;
    for (const candidate of observationSites()) {
      const site = asSite(candidate);
      if (chartedSiteObserved(world, site)) addCharted(candidate);
    }
    for (const record of sites) {
      if (record.geometryRevision === (world.terrainRevision ?? 0) || !chartedSiteObserved(world, record)) continue;
      record.geometryRevision = world.terrainRevision ?? 0;
      const current = observationSites().find(candidate => candidate.x === record.x && candidate.z === record.z);
      if (current) {
        record.rotations = [...new Set([...record.rotations, ...current.rotations])].sort((a, b) => a - b);
        record.water = { ...current.water };
      }
    }
  };

  const chartObserved = (x: number, z: number, radius: number) => {
    if (currentMode() === "revealed") return;
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius) || radius <= 0) return;
    for (const candidate of observationSites()) {
      const distance = Math.min(DMath.hypot(candidate.x - x, candidate.z - z),
        DMath.hypot(candidate.water.x - x, candidate.water.z - z));
      if (distance > radius + 1) continue;
      const site = asSite(candidate);
      if (chartedSiteObserved(world, site)) addCharted(candidate);
    }
    sightRevision = currentSightRevision();
  };

  const sourceWater = (sourceUid: number) => {
    if (hooks.sourceWater) return hooks.sourceWater(sourceUid);
    const source = completedHarbour(context, sourceUid);
    if (!source) return null;
    const key = `${sourceUid}:${candidates.revision()}`;
    if (!sourceWaters.has(key)) {
      const coast = findCoastalWorkSite(context, source, sea, new Set(), 36, planner().masks.turning);
      sourceWaters.set(key, coast ? { ...coast.water } : null);
    }
    return sourceWaters.get(key)!;
  };

  const freeCandidate = (candidate: AnchoredSite, owned: ReadonlySet<number>, sourceUid: number) => {
    if (hooks.claimed({ ...candidate })) return false;
    if (owned.has(landmassAt(world, candidate))) return false;
    if (foreignTerritory(candidate)) return false;
    return Boolean(sourceWater(sourceUid));
  };

  const unknownObservationPoints = (sourceUid: number, limit = OBSERVATION_POINTS) => {
    const water = sourceWater(sourceUid);
    if (!water) return [];
    const owned = ownLandmasses();
    const candidates = candidateSites().filter(candidate =>
      !isCharted(candidate) && freeCandidate(candidate, owned, sourceUid));
    const result: SettlementPoint[] = [];
    let previous = water, distance = 0;
    while (candidates.length && result.length < limit) {
      candidates.sort((a, b) => DMath.hypot(a.water.x - previous.x, a.water.z - previous.z) -
        DMath.hypot(b.water.x - previous.x, b.water.z - previous.z) || a.z - b.z || a.x - b.x);
      const candidate = candidates.shift()!;
      if (result.some(point => DMath.hypot(point.x - candidate.water.x, point.z - candidate.water.z) < POINT_SEPARATION))
        continue;
      const path = route(previous, candidate.water);
      if (!path) continue;
      const length = pointLength(previous, path);
      if (distance + length > ROUTE_LIMIT) continue;
      result.push({ ...candidate.water });
      previous = candidate.water; distance += length;
    }
    return result;
  };

  const status = (record: ChartedSite, sourceUid: number): ChartedSiteStatus => {
    const site = cloneChartedSite(record);
    if (!chartedSiteMatchesMap(site, world)) return { available: false, reason: "wrongMap", site };
    const owned = ownLandmasses();
    if (owned.has(landmassAt(world, site))) return { available: false, reason: "owned", site };
    if (foreignTerritory(site)) return { available: false, reason: "foreign", site };
    let target: NavalExpedition | null = null;
    for (const rotation of site.rotations) {
      target = hooks.site({ x: site.x, z: site.z, rotation });
      if (target) break;
    }
    if (!target) {
      const occupied = site.rotations.some(rotation =>
        chartedSiteFootprintCells(world, { ...site, rotation }).some(cell => context.occupied[cell]));
      return { available: false, reason: occupied ? "occupied" : "invalid", site };
    }
    if (record.geometryRevision !== (world.terrainRevision ?? 0) && currentMode() === "fog" &&
      !chartedSiteObserved(world, record)) return { available: false, reason: "unobserved", site };
    const water = sourceWater(sourceUid);
    if (!water || !route(water, target.water)) return { available: false, reason: "unreachable", site };
    if (hooks.claimed(target)) return { available: false, reason: "claimed", site };
    return { available: true, reason: "available", site, target };
  };

  const statuses = (sourceUid: number) => sites.map(record => status(record, sourceUid));

  const knownTargets = (sourceUid: number): NavalExpedition[] => {
    if (currentMode() === "revealed") {
      const water = sourceWater(sourceUid);
      if (!water) return [];
      const owned = ownLandmasses();
      return candidateSites().flatMap(candidate => {
        if (!freeCandidate(candidate, owned, sourceUid) || !route(water, candidate.water)) return [];
        return [{ ...candidate, water: { ...candidate.water } }];
      });
    }
    return statuses(sourceUid).flatMap(entry => entry.available && entry.target ? [entry.target] : []);
  };
  /**
   * One discovered, currently usable harbour spot per island. Finding one spot is enough to offer
   * that island for settlement; extra charted spots on the same landmass are not separate targets.
   * With fog of war off every free, reachable stored harbour spot counts as discovered (plan §8.6).
   */
  const settlementTargets = (sourceUid: number) => {
    const seen = new Set<number>(), result: NavalExpedition[] = [];
    for (const target of knownTargets(sourceUid)) {
      const island = landmassAt(world, target);
      if (island < 0 || seen.has(island)) continue;
      seen.add(island);
      result.push({ ...target, water: { ...target.water } });
    }
    return result;
  };

  const availability = (sourceUid: number): ScoutingAvailability => {
    const source = completedHarbour(context, sourceUid);
    if (!source) return { hidden: true, ready: false, reason: "harbour" };
    if (findHomeBuilding(context)?.typeId !== 0) return { hidden: true, ready: false, reason: "notHomeMap" };
    if (landmassCount(world) < 2) return { hidden: true, ready: false, reason: "landmasses" };
    if (currentMode() === "revealed") return { hidden: true, ready: false, reason: "noFog" };
    const feature = featureState(context, "explorationExpeditions");
    if (feature !== "on") return { hidden: feature === "gameOff", ready: false, reason: "featureOff" };
    if (hooks.active(sourceUid)) return { hidden: false, ready: false, reason: "active" };
    if (!unknownObservationPoints(sourceUid, 1).length) return { hidden: true, ready: false, reason: "noSites" };
    const supply = hooks.scoutSupply(sourceUid);
    if (supply.settlers < 1) return { hidden: false, ready: false, reason: "scout" };
    if (supply.spyglasses < 1) return { hidden: false, ready: false, reason: "spyglass" };
    const water = sourceWater(sourceUid);
    const reachable = water ? hooks.idleShips().filter(ship => ship.phase === "idle" && !ship.visitor &&
      ship.reservedFor === undefined && Boolean(route({ x: ship.x, z: ship.z }, water))).length : 0;
    if (reachable - hooks.pendingOrders() < 1) return { hidden: false, ready: false, reason: "ship" };
    return { hidden: false, ready: true };
  };

  const saveState = (): ChartedSitesSave => ({ mode: savedMode, sites: sites.map(cloneChartedSite) });
  const restore = (saved?: ChartedSitesSave, inPlace = false) => {
    savedMode = saved?.mode ?? hooks.mode ?? "fog";
    sites = (saved?.sites ?? []).map(cloneChartedSite);
    // An in-place snapshot reload writes back the same world and chart records. Keep the candidate
    // and source-water caches (and the sight revision): rebuilding every harbour candidate on the
    // next tick was the periodic-save frame stall. A fresh load rebuilds during loading instead.
    if (!inPlace) {
      candidates.clear(); sourceWaters.clear();
      sightRevision = "";
    }
  };

  return {
    /** Loading-only derived geometry; discovery and durable chart records remain unchanged. */
    prewarm: () => { planner(); return candidates.prewarm(); },
    afterInPlaceReload: candidates.afterInPlaceReload, availability, chartObserved, knownTargets, settlementTargets, refreshSight, restore, saveState,
    unknownObservationPoints,
    sites: () => sites.map(cloneChartedSite),
    statuses,
    mode: currentMode
  };
};
