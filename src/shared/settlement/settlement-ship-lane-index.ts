import { countNavigation, profileNavigationStage } from "./navigation-profile";
import { ENVELOPE_REACH, type ShipObstacle } from "./settlement-ship-clearance";

const NEIGHBOURHOOD_LIMIT = 256;

/** Exact broad phase for the existing strict lane gate; original lane order is retained for SAT tests. */
export const createShipLaneIndex = (ways: readonly ShipObstacle[]) => {
  // Twice the tested reach makes the neighbouring-cell query conservative at floating bucket boundaries.
  const size = ENVELOPE_REACH * 2;
  const columns = new Map<number, Map<number, number[]>>();
  for (const [index, way] of ways.entries()) {
    if (!Number.isFinite(way.x) || !Number.isFinite(way.z)) continue;
    const x = Math.floor(way.x / size), z = Math.floor(way.z / size);
    let column = columns.get(x);
    if (!column) { column = new Map(); columns.set(x, column); }
    let bucket = column.get(z);
    if (!bucket) { bucket = []; column.set(z, bucket); }
    bucket.push(index);
  }
  const near = (way: ShipObstacle, point: ShipObstacle) =>
    Math.abs(way.x - point.x) < ENVELOPE_REACH && Math.abs(way.z - point.z) < ENVELOPE_REACH;
  // One immutable lane snapshot serves many ring points in the same bucket neighbourhood.
  // Cache raw indices, then apply the original strict distance gate separately for each point.
  const neighbourhoods = new Map<string, readonly number[]>();
  return (point: ShipObstacle, overlaps: (way: ShipObstacle) => boolean) =>
    profileNavigationStage("ship.laneBroadPhase", () => {
    countNavigation("ship.laneQueries");
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z))
      return ways.some(way => near(way, point) && overlaps(way));
    const x = Math.floor(point.x / size), z = Math.floor(point.z / size);
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(z))
      return ways.some(way => near(way, point) && overlaps(way));
    const key = `${x},${z}`;
    let indexes = neighbourhoods.get(key);
    if (!indexes) {
      const candidates: number[] = [];
      for (let dx = -1; dx <= 1; dx++) {
        const column = columns.get(x + dx);
        if (!column) continue;
        for (let dz = -1; dz <= 1; dz++) for (const index of column.get(z + dz) ?? [])
          candidates.push(index);
      }
      candidates.sort((a, b) => a - b);
      if (neighbourhoods.size >= NEIGHBOURHOOD_LIMIT)
        neighbourhoods.delete(neighbourhoods.keys().next().value!);
      indexes = candidates;
      neighbourhoods.set(key, indexes);
    }
    return indexes.some(index => near(ways[index]!, point) && overlaps(ways[index]!));
  });
};
