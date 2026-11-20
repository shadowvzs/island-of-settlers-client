import { DMath } from "../math/deterministic-math";
import { sampleBilinear } from "../world/grid-geometry";
import type { Waterfall } from "../world/world-data";
import type { RoadPoint } from "./road-types";

/**
 * A bridge spans one level reach: never a waterfall, cascade ledge or plunge pool (TT-6). The deck
 * and its abutments sit on one water level, so the span keeps clear of every fall's lip and pool.
 */
export interface BridgeStepWorld {
  cellsX: number;
  cellsZ: number;
  waterDepth: Float32Array;
  waterfalls?: readonly Waterfall[];
  waterSurface?: Float32Array;
}

export type BridgeStepRejection = "across-water-step";

/** Water levels along the wet span may differ this much (gentle reach); more is a step. */
const MAX_LEVEL_SPREAD = 0.15;
/** Clearance (tiles) between a fall's lip or pool and the span with its abutments. */
const FALL_CLEARANCE = 2;
/** Abutment length (tiles) beyond each anchor that also keeps clear of falls. */
const ABUTMENT = 1;
const PROFILE_STEP = 0.25;

/** Distance from a point to the segment start - end. */
const segmentDistance = (point: RoadPoint, start: RoadPoint, end: RoadPoint) => {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const share = lengthSquared > 0
    ? Math.min(1, Math.max(0, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared))
    : 0;
  return DMath.hypot(point.x - start.x - dx * share, point.z - start.z - dz * share);
};

/** The span extended by an abutment at each end. */
const withAbutments = (start: RoadPoint, end: RoadPoint) => {
  const length = DMath.hypot(end.x - start.x, end.z - start.z) || 1;
  const unitX = (end.x - start.x) / length;
  const unitZ = (end.z - start.z) / length;
  return [
    { x: start.x - unitX * ABUTMENT, z: start.z - unitZ * ABUTMENT },
    { x: end.x + unitX * ABUTMENT, z: end.z + unitZ * ABUTMENT }
  ] as const;
};

const isNearFall = (fall: Waterfall, start: RoadPoint, end: RoadPoint) =>
  segmentDistance(fall, start, end) <= fall.width / 2 + FALL_CLEARANCE ||
  segmentDistance({ x: fall.poolX, z: fall.poolZ }, start, end) <= fall.poolRadius + FALL_CLEARANCE;

/** Spread of the water level over the wet samples of the span. */
const getLevelSpread = (world: BridgeStepWorld, surface: Float32Array, start: RoadPoint, end: RoadPoint) => {
  const steps = Math.max(1, Math.ceil(DMath.hypot(end.x - start.x, end.z - start.z) / PROFILE_STEP));
  let low = Infinity;
  let high = -Infinity;
  for (let step = 0; step <= steps; step += 1) {
    const x = start.x + (end.x - start.x) * step / steps;
    const z = start.z + (end.z - start.z) * step / steps;
    if (sampleBilinear(world, world.waterDepth, x, z) <= 0) continue;
    const level = sampleBilinear(world, surface, x, z);
    low = Math.min(low, level);
    high = Math.max(high, level);
  }
  return high > low ? high - low : 0;
};

/** Rejects a span across a step of the water level or near a fall (worlds without water data pass). */
export const bridgeStepProblem = (
  world: BridgeStepWorld,
  start: RoadPoint,
  end: RoadPoint
): BridgeStepRejection | null => {
  const [from, to] = withAbutments(start, end);
  if ((world.waterfalls ?? []).some((fall) => isNearFall(fall, from, to))) return "across-water-step";
  if (!world.waterSurface) return null;
  return getLevelSpread(world, world.waterSurface, start, end) > MAX_LEVEL_SPREAD ? "across-water-step" : null;
};
