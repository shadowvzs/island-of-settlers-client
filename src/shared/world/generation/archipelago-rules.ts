import { SAILING_SHIP_OVERALL_BEAM, SAILING_SHIP_SPACING, SAILING_SHIP_TURN_RADIUS } from "../../../render-common/ships/ship-dimensions";
import { DMath } from "../../math/deterministic-math";
import { ROAD_PLACEMENT_WIDTH } from "../../settlement/road-types";
import type { GridSize } from "../grid-geometry";
import { createFbm, type Noise2, smoothstep } from "../noise";
import { createRandom, deriveSeed } from "../rng";
import {
  type CoastDetailBounds, coastDetailFlankSlope, coastDetailIndent, coastDetailStrength, roundedCoastShare
} from "./coast-detail";

const RESERVED_ROAD_WIDTH = Math.ceil(ROAD_PLACEMENT_WIDTH);
/** Saved design dimensions in tiles: 2x2 plots, full road and verges between and around them. */
export const ISLAND_SPACE = Object.freeze({
  buildingSide: 5, columns: 2, rows: 2, roadWidth: RESERVED_ROAD_WIDTH,
  width: 2 * 5 + 3 * RESERVED_ROAD_WIDTH + 1, depth: 2 * 5 + 3 * RESERVED_ROAD_WIDTH + 1,
  channelWidth: Math.ceil(3 * (SAILING_SHIP_OVERALL_BEAM + SAILING_SHIP_SPACING) + 2 * 3),
  minimumRadius: 30,
  retries: 2
});
/** Sea kept between an island's coast envelope and the map edge: the ship turning circle plus four cells. */
const ISLAND_MAP_MARGIN = Math.ceil(SAILING_SHIP_TURN_RADIUS) + 4;
export interface IslandSite { x: number; z: number; radius: number; phase: number; spaceWidth: number; spaceDepth: number; buildingCount: number }
export const islandHeadquarters = (site: IslandSite) => ({ x: site.x, z: site.z - site.spaceDepth / 2 - 7 });

/** Conservative count that fits the minimum coast envelopes and three-ship channels. */
export const maxPlayableIslandCount = (cellsX: number, cellsZ = cellsX) => {
  const margin = ISLAND_MAP_MARGIN;
  const pitch = ISLAND_SPACE.minimumRadius * 2 + ISLAND_SPACE.channelWidth;
  const columns = Math.floor((cellsX - 2 * margin + ISLAND_SPACE.channelWidth) / pitch);
  const rows = Math.floor((cellsZ - 2 * margin + ISLAND_SPACE.channelWidth) / pitch);
  return Math.max(1, columns * rows);
};

const singleIslandSite = (grid: GridSize, phase: number): IslandSite => {
  const side = Math.min(grid.cellsX, grid.cellsZ);
  const compact = side < 80;
  return { x: Math.floor(grid.cellsX / 2), z: Math.floor(grid.cellsZ / 2) - (compact ? 6 : 0),
    radius: compact ? 24 : Math.floor(Math.min(side * .39, side / 2 - 10)), phase,
    spaceWidth: ISLAND_SPACE.width, spaceDepth: ISLAND_SPACE.depth, buildingCount: 4 };
};

/** Pack bounded coast envelopes; the sea gap includes the widest possible coast lobes. */
export const planPlayableIslands = (grid: GridSize, seed: number, similar = false, islandCount = 0): IslandSite[] => {
  const random = createRandom(deriveSeed(seed, "playable-islands"));
  const side = Math.min(grid.cellsX, grid.cellsZ);
  const margin = ISLAND_MAP_MARGIN;
  const space = ISLAND_SPACE;
  const capacity = maxPlayableIslandCount(grid.cellsX, grid.cellsZ);
  // An unspecified count follows the size table too: 64 and 128 maps hold one playable island.
  if (islandCount === 1 || (!islandCount && capacity === 1)) return [singleIslandSite(grid, random() * Math.PI * 2)];
  const dimensions = { spaceWidth: space.width, spaceDepth: space.depth, buildingCount: space.columns * space.rows };
  const baseRadius = Math.max(space.minimumRadius, Math.min(65, side * .14));
  if (islandCount > capacity)
    throw new Error(`Cannot fit ${islandCount} islands on this map without reducing the minimum usable space.`);
  const fixedCount = Number.isInteger(islandCount) && islandCount >= 1 && islandCount <= capacity;
  const wanted = fixedCount ? islandCount : Math.min(capacity, Math.max(2, Math.min(7, Math.floor(side / 80) + 1)));
  if (similar) {
    // Fit the requested count first, then spend the remaining room on land.
    // The old random packing fixed radius from map size alone, wasting space at low counts.
    let best = { columns: 0, rows: 0, radius: 0 };
    for (let columns = 1; columns <= wanted; columns++) {
      const rows = Math.ceil(wanted / columns);
      const radius = Math.floor(Math.min(
        (grid.cellsX - 2 * margin - (columns - 1) * space.channelWidth) / (2 * columns),
        (grid.cellsZ - 2 * margin - (rows - 1) * space.channelWidth) / (2 * rows)
      ));
      if (radius > best.radius) best = { columns, rows, radius };
    }
    if (best.radius >= space.minimumRadius) {
      const pitch = best.radius * 2 + space.channelWidth;
      return Array.from({ length: wanted }, (_, index) => {
        const row = Math.floor(index / best.columns);
        const rowCount = Math.min(best.columns, wanted - row * best.columns);
        return { ...dimensions, radius: best.radius, phase: random() * Math.PI * 2,
          x: Math.floor((grid.cellsX - (rowCount - 1) * pitch) / 2 + (index % best.columns) * pitch),
          z: Math.floor((grid.cellsZ - (best.rows - 1) * pitch) / 2 + row * pitch) };
      });
    }
  }
  const sites: IslandSite[] = [];
  for (let attempt = 0; attempt < 1200 && sites.length < wanted; attempt++) {
    const radius = Math.round(similar ? baseRadius : space.minimumRadius +
      random() * Math.max(0, baseRadius * 1.5 - space.minimumRadius));
    const edge = radius + margin;
    if (edge * 2 >= side) continue;
    const x = Math.round(edge + random() * (grid.cellsX - edge * 2));
    const z = Math.round(edge + random() * (grid.cellsZ - edge * 2));
    if (sites.some(site => Math.hypot(site.x - x, site.z - z) < site.radius + radius + ISLAND_SPACE.channelWidth)) continue;
    sites.push({ ...dimensions, x, z, radius, phase: random() * Math.PI * 2 });
  }
  if (sites.length < 2 && side >= 128) {
    // Repair an unlucky crowded packing with two seed-reflected diagonal sites.
    const radius = Math.max(space.minimumRadius, Math.min(baseRadius, side * .16));
    const edge = Math.ceil(radius + margin + 2);
    if (Math.hypot(grid.cellsX - edge * 2, grid.cellsZ - edge * 2) >= radius * 2 + ISLAND_SPACE.channelWidth) {
      sites.length = 0;
      const flip = random() < .5;
      sites.push({ ...dimensions, x: edge, z: flip ? grid.cellsZ - edge : edge, radius, phase: random() * 6.28 },
        { ...dimensions, x: grid.cellsX - edge, z: flip ? edge : grid.cellsZ - edge, radius, phase: random() * 6.28 });
    }
  }
  if (fixedCount && sites.length !== wanted) {
    const columns = Math.ceil(Math.sqrt(wanted)), rows = Math.ceil(wanted / columns);
    const cellWidth = (grid.cellsX - 2 * margin + ISLAND_SPACE.channelWidth) / columns;
    const cellDepth = (grid.cellsZ - 2 * margin + ISLAND_SPACE.channelWidth) / rows;
    const radius = Math.floor(Math.min(baseRadius, (Math.min(cellWidth, cellDepth) - ISLAND_SPACE.channelWidth) / 2));
    if (radius >= space.minimumRadius) {
      sites.length = 0;
      for (let index = 0; index < wanted; index++) {
        const x = Math.round(margin + radius + (index % columns) * cellWidth);
        const z = Math.round(margin + radius + Math.floor(index / columns) * cellDepth);
        const localRadius = similar ? radius : Math.round(space.minimumRadius + random() * (radius - space.minimumRadius));
        sites.push({ ...dimensions, x, z, radius: localRadius, phase: random() * Math.PI * 2 });
      }
    }
    if (sites.length !== wanted) throw new Error(`Cannot fit ${wanted} islands with the minimum buildable area, HQ, harbour and ship channels. Choose fewer islands or a larger map.`);
  }
  if (sites.length < 2) throw new Error("Islands need more space for the required buildings, HQ, harbour and ship channels. Choose a larger map.");
  return sites.sort((a, b) => b.radius - a.radius);
};

/**
 * Largest coast radius (cells, rounded down) site `index` may take in place: its 25-cell ship channels to
 * the other coast envelopes and the sea margin to the map edge stay as wide as the packing requires.
 */
export const getIslandRadiusRoom = (grid: GridSize, sites: readonly IslandSite[], index: number) => {
  const site = sites[index]!;
  let room = Math.min(site.x, site.z, grid.cellsX - site.x, grid.cellsZ - site.z) - ISLAND_MAP_MARGIN;
  for (let other = 0; other < sites.length; other++) {
    if (other === index) continue;
    const neighbour = sites[other]!;
    const distance = Math.hypot(neighbour.x - site.x, neighbour.z - site.z);
    room = Math.min(room, distance - neighbour.radius - ISLAND_SPACE.channelWidth);
  }
  return Math.floor(room);
};

/** Distance (cells) from a point outside an axis-aligned box; 0 inside it. */
const boxDistance = (dx: number, dz: number, halfWidth: number, halfDepth: number) =>
  Math.hypot(Math.max(0, Math.abs(dx) - halfWidth), Math.max(0, Math.abs(dz) - halfDepth));

/** Distance from the reserved production grid / HQ strip grown by `margin`; 0 on reserved ground. */
export const reservedGroundDistance = (site: IslandSite, x: number, z: number, margin = 0) => {
  const hq = islandHeadquarters(site);
  const stripTop = hq.z - 6, stripBottom = site.z + site.radius - 3;
  const grid = boxDistance(x - site.x, z - site.z, site.spaceWidth / 2 + margin, site.spaceDepth / 2 + margin);
  const strip = boxDistance(x - site.x, z - (stripTop + stripBottom) / 2, 6 + margin,
    (stripBottom - stripTop) / 2 + margin);
  return Math.min(grid, strip);
};

/** Reserve the production grid, a separate HQ clearing and connecting coastal road. */
export const reservedIslandGround = (site: IslandSite, x: number, z: number, margin = 0) =>
  reservedGroundDistance(site, x, z, margin) === 0;

/** Cells over which hill/mountain relief eases out around the flat reserved ground (no cut walls). */
const RESERVED_RELIEF_BLEND = 10;
/** 1 on the unindented southern harbour frontage (|dx| <= 8), fading out by |dx| = 16; 0 elsewhere. */
const harbourFrontage = (site: IslandSite, x: number, z: number) =>
  Math.max(0, Math.min(1, (16 - Math.abs(x - site.x)) / 8)) * (z > site.z ? 1 : 0);
/** Land height gained per cell inland from the island shore line (beach slope). */
const SHORE_SLOPE = .45;
/**
 * First-vertex sea depth along the harbour frontage. The harbour shore rule (settlement-sea-navigation
 * `findCoastalWorkSite`) needs ground at or below sea level one cell beyond the last dry cell; the plain
 * .45 beach slope only met it where the shore line crossed the grid near a vertex, so the smooth frontage of
 * large islands never qualified and the harbour depended on random coves (2026-10-19).
 */
const HARBOUR_QUAY_DEPTH = .6;

/** Repaired coast height at `shore` cells inside (negative: outside) the site's coast envelope. */
const islandCoastHeight = (site: IslandSite, x: number, z: number, shore: number) => {
  if (shore > 0) return Math.min(2, shore * SHORE_SLOPE);
  const quayDepth = HARBOUR_QUAY_DEPTH * harbourFrontage(site, x, z);
  return quayDepth > 0 ? Math.min(shore * SHORE_SLOPE, -quayDepth) : shore * SHORE_SLOPE;
};

/** Coast-profile envelope: the old three-sine indentation range, now a seeded multi-octave profile. */
const COAST_BASE_SHARE = 0.12;
const COAST_PROFILE_AMPLITUDE = 0.105;
const COAST_PROFILE_FREQUENCY = 1.8;
/** Phase is a radian fraction; scale it to an integer seed without losing site uniqueness. */
const COAST_PROFILE_SEED_SCALE = 1_000_000;
const COAST_MIN_SHARE = 0.015;
const COAST_MAX_SHARE = 0.225;
const coastProfiles = new WeakMap<IslandSite, Noise2>();
const getCoastNoise = (site: IslandSite) => {
  let noise = coastProfiles.get(site);
  if (!noise) {
    noise = createFbm(Math.floor(site.phase * COAST_PROFILE_SEED_SCALE), { octaves: 3 });
    coastProfiles.set(site, noise);
  }
  return noise;
};

/** Angular indentation share (0.015..0.225 of the radius), periodic and deterministic per site. */
export const getCoastIndentShare = (site: IslandSite, angle: number) => {
  const noise = getCoastNoise(site);
  const raw = COAST_BASE_SHARE + noise(
    DMath.cos(angle) * COAST_PROFILE_FREQUENCY,
    DMath.sin(angle) * COAST_PROFILE_FREQUENCY
  ) * COAST_PROFILE_AMPLITUDE;
  return Math.max(COAST_MIN_SHARE, Math.min(COAST_MAX_SHARE, raw));
};

/** Full radial coast profile for one angle: an irregular envelope with coves and headlands. */
export const getCoastProfile = (site: IslandSite, angle: number) =>
  site.radius * (1 - getCoastIndentShare(site, angle));

/** Bays and coves keep the coast this far (cells) outside the reserved plots and the HQ strip. */
const COAST_DETAIL_RESERVED_CLEARANCE = 14;
/**
 * Bays and coves spare a southern shelter around the harbour frontage (full within |dx| <= 16, gone
 * by |dx| = 34), so the harbour stands on a broad, rounded headland, not a cape.
 */
const DETAIL_SHELTER_FULL = 16;
const DETAIL_SHELTER_FADE = 18;
const DETAIL_SHELTER_ENTRY = .25;

/** The layout limits of the COAST-NATURAL tables, measured along one coast angle. */
const coastDetailBounds = (site: IslandSite): CoastDetailBounds => ({
  baseShare: angle => getCoastIndentShare(site, angle),
  limit: angle => {
    const dx = DMath.cos(angle), dz = DMath.sin(angle);
    let inner = 0;
    for (let distance = 0; distance <= site.radius; distance++)
      if (reservedGroundDistance(site, site.x + dx * distance, site.z + dz * distance) < COAST_DETAIL_RESERVED_CLEARANCE)
        inner = distance;
    return Math.max(0, getCoastProfile(site, angle) - inner);
  },
  // Smooth (S-shaped) fade: a linear one turns into a long straight bay flank in polar form.
  shelter: angle => smoothstep(DETAIL_SHELTER_FULL + DETAIL_SHELTER_FADE, DETAIL_SHELTER_FULL,
    Math.abs(DMath.cos(angle)) * site.radius) * smoothstep(0, DETAIL_SHELTER_ENTRY, DMath.sin(angle))
});
const boundsCache = new WeakMap<IslandSite, CoastDetailBounds>();
const getCoastDetailBounds = (site: IslandSite) => {
  let bounds = boundsCache.get(site);
  if (!bounds) { bounds = coastDetailBounds(site); boundsCache.set(site, bounds); }
  return bounds;
};

/**
 * Unindented northern coast near the HQ line. Large islands keep their HQ far inland; there the
 * reserved-ground clearance protects it and the narrow wedge would only leave a needle cape.
 */
const headquartersCoast = (site: IslandSite, x: number, z: number) =>
  Math.max(0, Math.min(1, (islandHeadquarters(site).z - z + 8) / 16)) *
  Math.max(0, 1 - Math.abs(x - site.x) / 12) * (1 - coastDetailStrength(site.radius));

export const islandShoreDistance = (site: IslandSite, x: number, z: number) => {
  const distance = DMath.hypot(x - site.x, z - site.z);
  const angle = DMath.atan2(z - site.z, x - site.x);
  // Keep the harbour's southern coast smooth, with gently irregular coves elsewhere.
  // The full native six-tile harbour, entrance/signpost and shore approach need
  // an unindented coast. Tapering immediately from x=0 multiplied tiny lateral
  // offsets by the island radius, drowning every candidate on a 512-cell island.
  const harbour = harbourFrontage(site, x, z);
  const protection = 1 - Math.max(harbour, headquartersCoast(site, x, z));
  if (coastDetailStrength(site.radius) <= 0) return site.radius - protection * site.radius *
    getCoastIndentShare(site, angle) - distance;
  const bounds = getCoastDetailBounds(site);
  const indent = protection * site.radius * roundedCoastShare(site, angle, bounds);
  const shore = site.radius - indent - coastDetailIndent(site, angle, distance, bounds) - distance;
  const flank = coastDetailFlankSlope(site, angle, distance, bounds);
  return shore / Math.sqrt(1 + flank * flank);
};

/** Repair the land before water, biomes and navigation are derived. Coast lobes only indent the envelope. */
export const shapePlayableIslands = (grid: GridSize, heights: Float32Array, sites: readonly IslandSite[], reservedOnly = false) => {
  for (let z = 0; z <= grid.cellsZ; z++) for (let x = 0; x <= grid.cellsX; x++) {
    if (reservedOnly && !sites.some(site => reservedIslandGround(site, x, z, 2))) continue;
    const index = z * (grid.cellsX + 1) + x;
    let height = -3;
    for (const site of sites) {
      const distance = Math.hypot(x - site.x, z - site.z);
      if (distance > site.radius + 8) continue;
      const shore = islandShoreDistance(site, x, z);
      const base = islandCoastHeight(site, x, z, shore);
      const coastEase = Math.max(0, Math.min(1, (shore - 8) / 8));
      const reservedEase = smoothstep(0, RESERVED_RELIEF_BLEND, reservedGroundDistance(site, x, z, 2));
      height = Math.max(height, base + Math.max(0, heights[index]! - 2) * coastEase * reservedEase);
    }
    heights[index] = height;
  }
};

/** Plateau flattening must not square off coves or raise a small separate coastal islet. */
export const clipIslandCoasts = (grid: GridSize, heights: Float32Array, sites: readonly IslandSite[], riverMask: Uint8Array) => {
  for (let z = 0; z <= grid.cellsZ; z++) for (let x = 0; x <= grid.cellsX; x++) {
    let shore = -Infinity, nearest = sites[0]!;
    for (const site of sites) {
      const siteShore = islandShoreDistance(site, x, z);
      if (siteShore > shore) { shore = siteShore; nearest = site; }
    }
    if (shore >= 7) continue;
    const index = z * (grid.cellsX + 1) + x;
    const coastHeight = islandCoastHeight(nearest, x, z, shore);
    heights[index] = riverMask[index] ? Math.min(heights[index]!, coastHeight) : coastHeight;
  }
};
