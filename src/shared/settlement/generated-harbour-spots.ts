import { DMath } from "../math/deterministic-math";
import { reservedIslandGround } from "../world/generation/archipelago-rules";
import { createReservedIslandContext } from "../world/generation/playable-islands";
import { sampleSmooth } from "../world/grid-geometry";
import { BLOCKING, type HarbourSpot, type PlayableIslandLayout, type WorldData } from "../world/world-data";
import {
  captureSpotTerrain, preLevelHarbourSpot, relightHarbourSpots, type SpotLevelling
} from "./harbour-spot-levelling";
import { harbourShoreRotation, rotationTowards } from "./settlement-harbour-facing";
import { landmassAt } from "./settlement-landmass-index";
import { makeBuilding, placementReason } from "./settlement-placement";
import { createSeaMask, findCoastalWorkSite } from "./settlement-sea-navigation";
import { createShipRoutePlanner } from "./settlement-ship-routes";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

/**
 * HARBOUR-SPOTS (owner 2026-11-09): with the generator's 'Potential harbour spots' option on, every
 * island of a multi-island map stores a few harbour plots on the FINAL coast. Each candidate plot is
 * cleared and pre-levelled first and kept only when it then passes the native expedition-site rules
 * (full harbour placement with berth/dock, flat footprint, shore workpoint with ship turning water);
 * otherwise its terrain is restored. A founding or harbour build there needs no shore levelling.
 */
const HARBOUR_TYPE = 39;
/**
 * Spots per island by coast size (owner 2026-11-09: two are enough, only very large islands get
 * more): radius < 90 → 2, 90..139 → 3, >= 140 → 4. For scale: minimum islands are 30, a 256² single
 * island is 99, a 512² single island 199.
 */
const SPOT_COUNT_BANDS = [{ minimumRadius: 140, spots: 4 }, { minimumRadius: 90, spots: 3 }] as const;
const DEFAULT_SPOT_COUNT = 2;
export const harbourSpotCount = (radius: number) =>
  SPOT_COUNT_BANDS.find(band => radius >= band.minimumRadius)?.spots ?? DEFAULT_SPOT_COUNT;
/** Spots of one island keep apart so they offer different coasts, not one beach twice. */
const SPOT_SPACING = 28;
/** Angular sectors the candidates are interleaved over (the proof harbour stays first). */
const COAST_SECTORS = 8;
/** Trial budget per island (each levels a plot and runs up to three full harbour/dock proofs). */
const MAX_TRIALS_PER_ISLAND = 30;
/** Plot centres this many cells (inclusive) from the open sea; sampled on an even-cell lattice. */
const SEA_REACH_MIN = 3;
const SEA_REACH_MAX = 8;
const CANDIDATE_STEP = 2;
/**
 * Natural height range a plot may have before pre-levelling: a beach ramp (.45 per cell) across the
 * whole 6-cell plot. The placement rule's 1.3 then holds on the levelled plot.
 */
const MAX_PLOT_RANGE = 2.8;
/** Plot height above the sea, so levelling can never lower ground into the water. */
const MIN_PLOT_HEIGHT = .15;
/** The expedition-site shore search (`settlement-naval-expeditions`). */
const LANDING_SHORE_RADIUS = 8;
/** Back to the sea first, then side-on to it (a dock may still reach the water from the side). */
const ROTATION_TRIALS = [0, 1, 3] as const;

interface SpotCandidate { range: number; reach: number; rotation: number; x: number; z: number }
interface SpotSearch {
  context: SettlementContext;
  sea: Uint8Array;
  turning: Uint8Array;
  world: WorldData;
}

/** Cell distance (4-neighbour steps) to the open sea, capped at `limit + 1`. */
const seaDistances = (world: WorldData, sea: Uint8Array, limit: number) => {
  const distance = new Uint8Array(sea.length).fill(limit + 1), queue: number[] = [];
  for (let cell = 0; cell < sea.length; cell++) if (sea[cell]) { distance[cell] = 0; queue.push(cell); }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor]!, next = distance[cell]! + 1;
    if (next > limit) continue;
    const x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, nz = z + dz, neighbour = nz * world.cellsX + nx;
      if (nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ || distance[neighbour]! <= next) continue;
      distance[neighbour] = next;
      queue.push(neighbour);
    }
  }
  return distance;
};

/** Height range of a dry 6x6 plot's vertices; Infinity when it leaves the map or touches water/cliff. */
const plotRange = (world: WorldData, x: number, z: number) => {
  if (x - 3 < 1 || z - 3 < 1 || x + 3 >= world.cellsX - 1 || z + 3 >= world.cellsZ - 1) return Infinity;
  for (let cellZ = z - 3; cellZ < z + 3; cellZ++) for (let cellX = x - 3; cellX < x + 3; cellX++) {
    const blocking = world.blocking[cellZ * world.cellsX + cellX];
    if (blocking === BLOCKING.water || blocking === BLOCKING.cliff) return Infinity;
  }
  let lowest = Infinity, highest = -Infinity;
  for (let vertexZ = z - 3; vertexZ <= z + 3; vertexZ++) for (let vertexX = x - 3; vertexX <= x + 3; vertexX++) {
    const height = world.heights[vertexZ * (world.cellsX + 1) + vertexX]!;
    lowest = Math.min(lowest, height); highest = Math.max(highest, height);
  }
  return highest - lowest;
};

const touchesReservedGround = (site: PlayableIslandLayout["sites"][number], x: number, z: number) =>
  [[-3, -3], [3, -3], [-3, 3], [3, 3], [0, 0]].some(([dx, dz]) => reservedIslandGround(site, x + dx!, z + dz!, 1));

/** Round robin over angular sectors, each in its own order: spots spread around the whole coast. */
const aroundTheCoast = (site: PlayableIslandLayout["sites"][number], candidates: readonly SpotCandidate[]) => {
  const sectors: SpotCandidate[][] = Array.from({ length: COAST_SECTORS }, () => []);
  for (const candidate of candidates) {
    const turn = (DMath.atan2(candidate.z - site.z, candidate.x - site.x) / (2 * Math.PI) + 1) % 1;
    sectors[Math.min(COAST_SECTORS - 1, Math.floor(turn * COAST_SECTORS))]!.push(candidate);
  }
  const ordered: SpotCandidate[] = [];
  for (let rank = 0; ordered.length < candidates.length; rank++)
    for (const sector of sectors) if (sector[rank]) ordered.push(sector[rank]!);
  return ordered;
};

/** Shore plots of one island, nearest the sea and flattest first; the harbour of the generation proof leads. */
const islandCandidates = (search: SpotSearch, site: PlayableIslandLayout["sites"][number],
  distances: Uint8Array) => {
  const { sea, world } = search;
  const island = landmassAt(world, site);
  const result: SpotCandidate[] = [];
  const reach = site.radius + 2;
  for (let z = Math.max(4, site.z - reach); z <= Math.min(world.cellsZ - 4, site.z + reach); z += CANDIDATE_STEP)
    for (let x = Math.max(4, site.x - reach); x <= Math.min(world.cellsX - 4, site.x + reach); x += CANDIDATE_STEP) {
      const cell = z * world.cellsX + x, distance = distances[cell]!;
      if (distance < SEA_REACH_MIN || distance > SEA_REACH_MAX || world.blocking[cell] === BLOCKING.water) continue;
      if (landmassAt(world, { x, z }) !== island || touchesReservedGround(site, x, z)) continue;
      if (sampleSmooth(world, world.heights, x, z) < world.seaLevel + MIN_PLOT_HEIGHT) continue;
      const range = plotRange(world, x, z);
      if (range > MAX_PLOT_RANGE) continue;
      const rotation = harbourShoreRotation(world, sea, x, z, rotationTowards(site.x - x, site.z - z));
      if (rotation !== null) result.push({ range, reach: distance, rotation, x, z });
    }
  // Nearest the sea first (the 8-tile shore rule from the inland entrance), then the flattest.
  result.sort((a, b) => a.reach - b.reach || a.range - b.range || a.z - b.z || a.x - b.x);
  return [{ range: 0, reach: 0, ...site.harbour }, ...aroundTheCoast(site, result)];
};

/** The native expedition-site proof: full harbour placement plus the landing shore search. */
const validateSpot = (search: SpotSearch, candidate: Omit<SpotCandidate, "range">) => {
  const { context, sea, turning } = search;
  const next = context.nextBuilding;
  const building = makeBuilding(context, HARBOUR_TYPE, candidate.x, candidate.z, candidate.rotation);
  context.nextBuilding = next;
  if (placementReason(context, building)) return null;
  const coast = findCoastalWorkSite(context, building, sea, new Set(), LANDING_SHORE_RADIUS, turning);
  return coast && { building, coast };
};

/** Levels the plot, proves it at the trial rotations and keeps the first valid one, else restores. */
const trySpot = (search: SpotSearch, candidate: SpotCandidate, levellings: SpotLevelling[]) => {
  const { context, world } = search;
  const next = context.nextBuilding;
  const plot = makeBuilding(context, HARBOUR_TYPE, candidate.x, candidate.z, candidate.rotation);
  context.nextBuilding = next;
  const restore = captureSpotTerrain(world, plot);
  const levelling = preLevelHarbourSpot(world, plot);
  // Ground, walk and build layers changed: drop the context's cached shore paths and answers.
  context.navigationRevision = (context.navigationRevision ?? 0) + 1;
  for (const turn of ROTATION_TRIALS) {
    const proof = validateSpot(search, { ...candidate, rotation: (candidate.rotation + turn) % 4 });
    if (!proof) continue;
    levellings.push(levelling);
    return proof.building;
  }
  restore();
  context.navigationRevision++;
  return null;
};

const chooseIslandSpots = (search: SpotSearch, site: PlayableIslandLayout["sites"][number],
  distances: Uint8Array, levellings: SpotLevelling[]) => {
  const chosen: SettlementBuilding[] = [];
  let trials = 0;
  for (const candidate of islandCandidates(search, site, distances)) {
    if (chosen.length >= harbourSpotCount(site.radius) || trials >= MAX_TRIALS_PER_ISLAND) break;
    if (chosen.some(spot => DMath.hypot(spot.x - candidate.x, spot.z - candidate.z) < SPOT_SPACING)) continue;
    trials++;
    const spot = trySpot(search, candidate, levellings);
    if (spot) chosen.push(spot);
  }
  return chosen;
};

const createSpotSearch = (world: WorldData, layout: PlayableIslandLayout): SpotSearch => {
  const sea = createSeaMask(world);
  return { context: createReservedIslandContext(world, layout.sites), sea, world,
    turning: createShipRoutePlanner(world, sea).masks.turning };
};

const describeSpot = (search: SpotSearch, plot: SettlementBuilding): HarbourSpot | null => {
  const proof = validateSpot(search, { ...plot, reach: 0 });
  if (!proof) return null;
  const { coast } = proof;
  return { land: { ...coast.land }, rotation: plot.rotation, water: { ...coast.water }, x: plot.x,
    yaw: coast.yaw ?? 0, z: plot.z };
};

/**
 * Chooses, pre-levels and stores the spots of every island; returns the spot count per island.
 * Levelling only touches dry vertices, so the sea, berths and turning water stay the same; every
 * spot is still proven again on the levelled terrain before it is stored.
 */
export const placeHarbourSpots = (world: WorldData) => {
  const layout = world.playableIslands;
  if (!layout || layout.sites.length < 2) return [];
  const search = createSpotSearch(world, layout);
  const distances = seaDistances(world, search.sea, SEA_REACH_MAX);
  const levellings: SpotLevelling[] = [];
  const plots = layout.sites.map(site => chooseIslandSpots(search, site, distances, levellings));
  relightHarbourSpots(world, levellings);
  // A later spot's apron can touch an earlier one's shore: prove every kept spot once more.
  const proof = createSpotSearch(world, layout);
  layout.sites.forEach((site, index) => {
    site.harbourSpots = plots[index]!.flatMap(plot => describeSpot(proof, plot) ?? []);
  });
  return layout.sites.map(site => site.harbourSpots!.length);
};
