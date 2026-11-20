import type { GridSize } from "../grid-geometry";
import {
  getIslandRadiusRoom,
  islandShoreDistance,
  type IslandSite,
  reservedGroundDistance,
  reservedIslandGround} from "./archipelago-rules";
import { ISLAND_SLOPE } from "./landforms";
import { toReferenceUnits } from "./world-scale";

/**
 * Owner decision 2026-10-19 (DEC-06): an Islands map that requests rivers grows natural uplands on
 * its planned islands (the ordinary hill/massif code on island-shaped land), so river springs
 * qualify. Without rivers, and on colony/adventure worlds, the Islands terrain stays unchanged.
 */
export const wantsIslandUplands = (sites: readonly IslandSite[] | undefined, rivers: number) =>
  sites !== undefined && sites.length > 0 && rivers > 0;

/** The uplands follow the mountain option, but "None" still keeps low massifs for the springs. */
const MIN_UPLAND_MOUNTAINS = 0.35;

export const getIslandUplandMountains = (mountains: number) => Math.max(MIN_UPLAND_MOUNTAINS, mountains);

/** Land (cells inland) kept over the reserved ground: low land, neither coast nor mountain ground. */
const RESERVED_PLAIN_CELLS = 3;
/** Reserved ground grown by this margin (cells), as the island repair flattens it. */
const RESERVED_MARGIN = 2;
/** Beyond its radius plus this many cells a site only contributes its sea floor slope. */
const SHORE_DETAIL_REACH = 8;

const getSiteLandCells = (site: IslandSite, x: number, z: number) => {
  const distance = Math.hypot(x - site.x, z - site.z);
  if (distance > site.radius + SHORE_DETAIL_REACH) return site.radius - distance;
  const reserved = reservedGroundDistance(site, x, z, RESERVED_MARGIN);
  return Math.min(islandShoreDistance(site, x, z), RESERVED_PLAIN_CELLS + reserved);
};

/** Massifs asked for per island: one on each side of the central plots where room allows. */
const MASSIFS_PER_ISLAND = 2;

/** Land of the planned upland islands for the shape fields (heights.ts). */
export interface IslandUplandShape {
  /** Continentalness at a vertex: > 0 on land, rising about 1.2 per reference unit inland. */
  land: (vertexX: number, vertexZ: number) => number;
  /** One massif per island at least, where its mask and coast room allow it. */
  minimumMassifs: number;
}

/**
 * Continentalness of the planned islands (replaces the random archipelago shape): it rises inland
 * like the single island's slope and dips to a low plain over the reserved building ground, so the
 * massifs, foothills and coast room of heights.ts land between the plots and the sea.
 */
export const createIslandUplandShape = (sites: readonly IslandSite[]): IslandUplandShape => ({
  land: (x, z) => {
    let cells = -Infinity;
    for (const site of sites) cells = Math.max(cells, getSiteLandCells(site, x, z));
    return toReferenceUnits(cells) * ISLAND_SLOPE;
  },
  minimumMassifs: sites.length * MASSIFS_PER_ISLAND
});

/** Shortest upland stream (vertices): an island's springs lie close to its sea. */
export const ISLAND_UPLAND_RIVER_LENGTH = 16;

/** Rivers keep this far (cells) from the reserved plots, HQ strip and harbour road. */
const RIVER_RESERVED_CLEARANCE = 4;

/** True where a river must not run: on or next to an island's reserved ground. */
export const createReservedRiverKeepOut = (sites: readonly IslandSite[]) => (x: number, z: number) =>
  sites.some((site) => reservedIslandGround(site, x, z, RIVER_RESERVED_CLEARANCE));

/** Smallest coast radius (cells) whose uplands past the eased plots hold a spring. */
export const UPLAND_ISLAND_RADIUS = 40;
/** Rivers an island is expected to hold: one per this many cells of radius above the base below. */
const RADIUS_PER_RIVER = 2;
const RIVER_FREE_RADIUS = UPLAND_ISLAND_RADIUS - RADIUS_PER_RIVER;

const getExpectedRivers = (radius: number) => Math.floor((radius - RIVER_FREE_RADIUS) / RADIUS_PER_RIVER);

/** Islands too small for uplands, the largest (least growth) first; ties keep the planned order. */
const getSmallIslandOrder = (sites: readonly IslandSite[]) =>
  sites
    .map((site, index) => ({ index, radius: site.radius }))
    .filter((site) => site.radius < UPLAND_ISLAND_RADIUS)
    .sort((first, second) => second.radius - first.radius || first.index - second.index)
    .map((site) => site.index);

/**
 * Owner decision 2026-10-19 (DEC-06 follow-up): the river option is one total for the whole map. When
 * the uplands hold fewer rivers than requested, islands too small for uplands grow in place, the
 * largest first, until the expected rivers (one per 2 cells of radius above 38) cover the missing
 * ones. An island grows only where its ship channels and map margin keep their width (no merging),
 * at most to that room; one without room for UPLAND_ISLAND_RADIUS stays as planned. Returns the
 * grown sites, or undefined when nothing grows.
 */
export const growIslandsForRivers = (grid: GridSize, sites: readonly IslandSite[], missingRivers: number) => {
  if (missingRivers <= 0) return undefined;
  const grown = sites.map((site) => ({ ...site }));
  let missing = missingRivers;
  for (const index of getSmallIslandOrder(grown)) {
    if (missing <= 0) break;
    const wanted = RIVER_FREE_RADIUS + missing * RADIUS_PER_RIVER;
    const radius = Math.min(wanted, getIslandRadiusRoom(grid, grown, index));
    if (radius < UPLAND_ISLAND_RADIUS) continue;
    grown[index]!.radius = radius;
    missing -= getExpectedRivers(radius);
  }
  return missing < missingRivers ? grown : undefined;
};
