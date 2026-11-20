import { DMath } from "../math/deterministic-math";
import {
  BUILDING_FOOTPRINTS,
  type BuildingFootprint,
  FOOTPRINT_KINDS,
  type FootprintKind,
  getFootprintDimensions,
  getFootprintMinimums,
  getFootprintSpans} from "./building-footprints";
import { getCellCount, type GridSize,readVertex } from "./grid-geometry";
import { BUILD } from "./world-data";

/** What footprint packing reads: the cell build classes and the vertex heights. */
export interface BuildSite extends GridSize {
  buildClass: Uint8Array;
  heights: Float32Array;
}

export type FootprintCounts = Record<FootprintKind, number>;
/** Optional generation-only packing policy; legacy footprint data retains its original access strip. */
export interface PackingFootprint extends BuildingFootprint { accessMargin?: number }
const packingSpans = (footprint: PackingFootprint) => {
  if (footprint.accessMargin === undefined) return getFootprintSpans(footprint);
  const dimensions = getFootprintDimensions(footprint);
  return { width: dimensions.width + footprint.accessMargin, depth: dimensions.depth + footprint.accessMargin };
};

interface Point {
  x: number;
  z: number;
}

/**
 * Foundation cells: buildable ground (no mine land, no flag-only steep cell), or mine land for a
 * mine.
 */
const isFoundationCell = (buildClass: number, footprint: BuildingFootprint) => {
  if (footprint.ground === "mine") return buildClass === BUILD.mine;
  return buildClass >= BUILD.small && buildClass <= BUILD.large;
};

/** Access strip cells: any passable ground (free, not a cliff). */
const isAccessCell = (buildClass: number) => buildClass !== BUILD.none;

/** Height difference over the foundation corners (all vertices of the footprint). */
const getFoundationRise = (
  site: BuildSite,
  cellX: number,
  cellZ: number,
  width: number,
  depth: number
) => {
  let min = Infinity;
  let max = -Infinity;
  for (let vertexZ = cellZ; vertexZ <= cellZ + depth; vertexZ += 1) {
    for (let vertexX = cellX; vertexX <= cellX + width; vertexX += 1) {
      const height = readVertex(site, site.heights, vertexX, vertexZ);
      min = Math.min(min, height);
      max = Math.max(max, height);
    }
  }
  return max - min;
};

const areCellsUsable = (
  site: BuildSite,
  taken: Uint8Array,
  cellX: number,
  cellZ: number,
  footprint: PackingFootprint
) => {
  const span = packingSpans(footprint);
  const dimensions = getFootprintDimensions(footprint);
  for (let dz = 0; dz < span.depth; dz += 1) {
    for (let dx = 0; dx < span.width; dx += 1) {
      const index = (cellZ + dz) * site.cellsX + cellX + dx;
      if (taken[index] === 1) return false;
      const buildClass = site.buildClass[index]!;
      const isCore = dx < dimensions.width && dz < dimensions.depth;
      if (isCore && !isFoundationCell(buildClass, footprint)) return false;
      if (!isAccessCell(buildClass)) return false;
    }
  }
  return true;
};

/** True when the foundation (anchored at its north west cell) and its access strip fit. */
export const fitsFootprint = (
  site: BuildSite,
  taken: Uint8Array,
  cellX: number,
  cellZ: number,
  footprint: PackingFootprint
) => {
  const span = packingSpans(footprint);
  const dimensions = getFootprintDimensions(footprint);
  if (
    cellX < 0 ||
    cellZ < 0 ||
    cellX + span.width > site.cellsX ||
    cellZ + span.depth > site.cellsZ
  ) {
    return false;
  }
  if (!areCellsUsable(site, taken, cellX, cellZ, footprint)) return false;
  return (
    getFoundationRise(site, cellX, cellZ, dimensions.width, dimensions.depth) <= footprint.maxRise
  );
};

const claimFootprint = (
  site: BuildSite,
  taken: Uint8Array,
  cellX: number,
  cellZ: number,
  footprint: PackingFootprint
) => {
  const span = packingSpans(footprint);
  for (let dz = 0; dz < span.depth; dz += 1) {
    taken.fill(
      1,
      (cellZ + dz) * site.cellsX + cellX,
      (cellZ + dz) * site.cellsX + cellX + span.width
    );
  }
};

/** Greedy row major packing: how many non-overlapping footprints of one size fit. */
export const countFootprints = (site: BuildSite, footprint: BuildingFootprint) => {
  const taken = new Uint8Array(getCellCount(site));
  let count = 0;
  for (let cellZ = 0; cellZ < site.cellsZ; cellZ += 1) {
    for (let cellX = 0; cellX < site.cellsX; cellX += 1) {
      if (!fitsFootprint(site, taken, cellX, cellZ, footprint)) continue;
      claimFootprint(site, taken, cellX, cellZ, footprint);
      count += 1;
    }
  }
  return count;
};

/** Packing count of every footprint size, each on its own (empty) island. */
export const countAllFootprints = (site: BuildSite): FootprintCounts => ({
  large: countFootprints(site, BUILDING_FOOTPRINTS.large),
  standard: countFootprints(site, BUILDING_FOOTPRINTS.standard),
  tower: countFootprints(site, BUILDING_FOOTPRINTS.tower)
});

/**
 * How far the site falls short of the island minimums, in standard plots: the worst kind's
 * missing share of its minimum, applied to the standard minimum (0 when every kind is met).
 */
export const getFootprintShortfall = (site: BuildSite, landCells: number) => {
  const counts = countAllFootprints(site);
  const minimums = getFootprintMinimums(landCells);
  let missing = 0;
  for (const kind of FOOTPRINT_KINDS) {
    if (counts[kind] >= minimums[kind]) continue;
    missing = Math.max(missing, (minimums[kind] - counts[kind]) / minimums[kind]);
  }
  return missing > 0 ? Math.ceil(missing * Math.max(1, minimums.standard)) : 0;
};

/** Anchors whose foundation centre lies within the radius, nearest first. */
const listAnchorsAround = (site: BuildSite, centre: Point, radius: number, size: number, depth = size) => {
  const anchors: { distance: number; x: number; z: number }[] = [];
  const half = size / 2;
  const halfDepth = depth / 2;
  const minX = Math.max(0, Math.floor(centre.x - radius - half));
  const minZ = Math.max(0, Math.floor(centre.z - radius - halfDepth));
  const maxX = Math.min(site.cellsX - 1, Math.ceil(centre.x + radius));
  const maxZ = Math.min(site.cellsZ - 1, Math.ceil(centre.z + radius));
  for (let z = minZ; z <= maxZ; z += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = DMath.hypot(x + half - centre.x, z + halfDepth - centre.z);
      if (distance <= radius) anchors.push({ distance, x, z });
    }
  }
  return anchors.sort((a, b) => a.distance - b.distance);
};

/**
 * Places the plan (e.g. a headquarters and eight houses) one by one, each as close to the centre
 * as it fits within the radius. Returns how many buildings of the plan found a place.
 */
export const packAround = (
  site: BuildSite,
  centre: Point,
  radius: number,
  plan: readonly FootprintKind[],
  footprints: Readonly<Record<FootprintKind, PackingFootprint>> = BUILDING_FOOTPRINTS
) => {
  const taken = new Uint8Array(getCellCount(site));
  const anchorsBySize = new Map<string, Point[]>();
  let placed = 0;
  for (const kind of plan) {
    const footprint = footprints[kind], { depth, width } = getFootprintDimensions(footprint);
    const dimensionsKey = `${width}:${depth}`;
    const anchors =
      anchorsBySize.get(dimensionsKey) ?? listAnchorsAround(site, centre, radius, width, depth);
    anchorsBySize.set(dimensionsKey, anchors);
    const spot = anchors.find(({ x, z }) => fitsFootprint(site, taken, x, z, footprint));
    if (!spot) continue;
    claimFootprint(site, taken, spot.x, spot.z, footprint);
    placed += 1;
  }
  return placed;
};
