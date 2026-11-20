import { DMath } from "../math/deterministic-math";
import type { WorldData } from "../world/world-data";
import { ANCHORAGE_SPACING } from "./settlement-ship-anchorage";
import type { ShipObstacle } from "./settlement-ship-clearance";
import type { ShipDestination } from "./settlement-ship-routes";
import type { SettlementPoint } from "./settlement-types";

/** Rings round the centre (tiles), each tried in this many headings, nearest first. */
const RING_RADII = [14, 20, 26, 32, 40, 48, 56, 64, 80, 96];
const RING_HEADINGS = 16;
/** Route checks one search may spend. */
const ROUTE_TRIES = 8;

export interface OpenWaterSearch {
  /** Water the spot must keep clear of (harbour lanes and berths, a requesting ship's way). */
  clear: (point: SettlementPoint) => boolean;
  /** Both points lie in one body of turning-clear water (one unreachable spot rules out its whole body). */
  connected: (a: SettlementPoint, b: SettlementPoint) => boolean;
  held: readonly ShipObstacle[];
  /** Whether the ship can sail there past the held hulls. */
  reaches: (point: ShipDestination) => boolean;
  turning: Uint8Array;
  world: Pick<WorldData, "cellsX" | "cellsZ">;
}

/** Open sea beyond the rings is looked for at turning-clear cells this far apart (tiles). */
const OPEN_SEA_STEP = 4;
/** Bodies of water the open-sea search may try to reach (one route check each). */
const OPEN_SEA_ROUTE_TRIES = 6;

/** Whether a ship may lie at `point`: turning-clear water off the kept-clear water and the other hulls. */
const isFreeWater = (point: SettlementPoint, search: OpenWaterSearch) => {
  const { cellsX, cellsZ } = search.world;
  if (point.x < 0 || point.z < 0 || point.x >= cellsX || point.z >= cellsZ) return false;
  if (!search.turning[Math.floor(point.z) * cellsX + Math.floor(point.x)] || !search.clear(point)) return false;
  return search.held.every(other => DMath.hypot(other.x - point.x, other.z - point.z) >= ANCHORAGE_SPACING);
};

/** Free water on the rings round `centre`, nearest ring first, headings in a fixed order. */
const ringSpot = (centre: SettlementPoint, search: OpenWaterSearch): ShipDestination | null => {
  let tries = 0;
  for (const radius of RING_RADII) for (let step = 0; step < RING_HEADINGS; step++) {
    const angle = step / RING_HEADINGS * Math.PI * 2;
    const point = { x: centre.x + DMath.cos(angle) * radius, yaw: angle + Math.PI / 2,
      z: centre.z + DMath.sin(angle) * radius };
    if (!isFreeWater(point, search)) continue;
    if (tries++ >= ROUTE_TRIES) return null;
    if (search.reaches(point)) return point;
  }
  return null;
};

/**
 * The open sea outside a narrow channel (owner, 2026-11-17): the nearest free turning-clear water anywhere on the
 * map, sampled every `OPEN_SEA_STEP` tiles (the rings miss a channel's far end and a sea beyond a strait). Nearest
 * first, ties by row then column; the ship lies heading away from `centre`.
 */
const openSeaSpot = (centre: SettlementPoint, search: OpenWaterSearch): ShipDestination | null => {
  const { cellsX, cellsZ } = search.world, candidates: (ShipDestination & { distance: number })[] = [];
  for (let z = OPEN_SEA_STEP / 2; z < cellsZ; z += OPEN_SEA_STEP) for (let x = OPEN_SEA_STEP / 2; x < cellsX;
    x += OPEN_SEA_STEP) {
    if (!search.turning[z * cellsX + x]) continue;
    const point = { x: x + .5, z: z + .5 };
    candidates.push({ ...point, distance: DMath.hypot(point.x - centre.x, point.z - centre.z),
      yaw: DMath.atan2(point.x - centre.x, point.z - centre.z) });
  }
  candidates.sort((a, b) => a.distance - b.distance || a.z - b.z || a.x - b.x);
  const unreachable: SettlementPoint[] = [];
  for (const { distance: _distance, ...point } of candidates) {
    if (!isFreeWater(point, search) || unreachable.some(other => search.connected(other, point))) continue;
    if (unreachable.length >= OPEN_SEA_ROUTE_TRIES) return null;
    if (search.reaches(point)) return point;
    unreachable.push(point);
  }
  return null;
};

/**
 * Open turning water round `centre` where a ship can lie: the last resort of a harbour whose waiting ring has no
 * free spot (2026-11-17, seed 123: a harbour by the map edge with room for one waiting ship). The rings round it
 * first; failing those, the open sea outside its channel. Deterministic: fixed orders throughout.
 */
export const findOpenWaterSpot = (centre: SettlementPoint, search: OpenWaterSearch): ShipDestination | null =>
  ringSpot(centre, search) ?? openSeaSpot(centre, search);
