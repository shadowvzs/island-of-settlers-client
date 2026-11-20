import { ROAD_SPEED } from "@shared/catalog/balance";

import { DMath } from "../math/deterministic-math";
import { ROAD_GRID_STEP, ROAD_TIER_WIDTH, type RoadPoint, type RoadSegment, snapRoadPoint } from "./road-types";

/** Nearby half-cell nodes cover every canonical paved ribbon without scanning the road network. */
const SPEED_PROBES: ReadonlyArray<readonly [number, number]> =
  [[0, 0], [ROAD_GRID_STEP, 0], [-ROAD_GRID_STEP, 0], [0, ROAD_GRID_STEP], [0, -ROAD_GRID_STEP]];
const NO_LONG_EDGES: readonly RoadSegment[] = [];

interface NearestTier {
  closest: number;
  tier: RoadSegment["tier"];
}

/** Keeps the nearest covering segment, preferring the faster tier on a tie. */
const considerSegment = (nearest: NearestTier, segment: RoadSegment, position: RoadPoint) => {
  const dx = segment.end.x - segment.start.x,
    dz = segment.end.z - segment.start.z;
  const fraction =
    ((position.x - segment.start.x) * dx + (position.z - segment.start.z) * dz) /
    (dx * dx + dz * dz);
  if (fraction < -1e-7 || fraction > 1 + 1e-7) return;
  const distance = DMath.hypot(
    position.x - segment.start.x - fraction * dx,
    position.z - segment.start.z - fraction * dz
  );
  if (distance > nearest.closest + 1e-7) return;
  const tied = Math.abs(distance - nearest.closest) < 1e-7;
  if (!tied || ROAD_SPEED[segment.tier] > ROAD_SPEED[nearest.tier]) nearest.tier = segment.tier;
  nearest.closest = distance;
};

/**
 * `longEdges` lists the graph edges longer than one half cell (angled bridge decks), whose middle
 * lies beyond the node probes.
 */
export const createRoadSpeedLookup = (
  getSegments: (point: RoadPoint) => ReadonlyMap<number, RoadSegment> | undefined,
  longEdges: () => readonly RoadSegment[] = () => NO_LONG_EDGES
) => (position: RoadPoint) => {
  const centre = snapRoadPoint(position);
  const nearest: NearestTier = { closest: Infinity, tier: "dirt" };
  for (const [offsetX, offsetZ] of SPEED_PROBES) {
    const nearby = getSegments({ x: centre.x + offsetX, z: centre.z + offsetZ });
    if (!nearby) continue;
    for (const segment of nearby.values()) considerSegment(nearest, segment, position);
  }
  for (const segment of longEdges()) considerSegment(nearest, segment, position);
  // Upgraded edges widen in place: their whole canonical paved ribbon is fast.
  return nearest.closest <= ROAD_TIER_WIDTH[nearest.tier] / 2 + 0.01 ? ROAD_SPEED[nearest.tier] : ROAD_SPEED.dirt;
};
