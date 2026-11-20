import { DMath } from "../math/deterministic-math";
import { sampleBilinear } from "../world/grid-geometry";
import type { RoadPoint } from "./road-types";

/**
 * The one "does this span cross the river?" rule, shared by the planner, the placement overlay and
 * save validation. A bridge must leave dry ground on one bank, cross the water channel once and land
 * on dry ground of the opposite bank: never along a bank, over land, or across the tip of a pool.
 */
export interface BridgeWaterWorld {
  cellsX: number;
  cellsZ: number;
  waterDepth: Float32Array;
}

export type BridgeBankRejection = "not-across-river";

const WATER_EPSILON = 1e-6;
/** Centreline sampling step for the single dry-wet-dry profile. */
const PROFILE_STEP = 0.125;
/**
 * Land detour (cells) allowed around the span: anchors that dry land joins within this margin of the
 * span's bounds lie on the same bank (or the water is only a pool tip a walker can step around).
 */
export const BRIDGE_BANK_DETOUR_MARGIN = 4;

export const isBridgeWater = (world: BridgeWaterWorld, point: RoadPoint) =>
  sampleBilinear(world, world.waterDepth, point.x, point.z) > WATER_EPSILON;

export const inBridgeBounds = (world: BridgeWaterWorld, point: RoadPoint) =>
  point.x >= 0 && point.z >= 0 && point.x <= world.cellsX && point.z <= world.cellsZ;

interface WetProfile {
  /** Distance along the span to the first and last wet sample. */
  first: number;
  last: number;
  /** Separate wet stretches on the centreline (-1: an end stands in the water). */
  runs: number;
}

/** Wet stretches on the straight centreline; both ends must be dry. */
const wetProfile = (world: BridgeWaterWorld, start: RoadPoint, end: RoadPoint): WetProfile => {
  const length = DMath.hypot(end.x - start.x, end.z - start.z);
  const steps = Math.max(1, Math.ceil(length / PROFILE_STEP));
  const profile = { first: -1, last: -1, runs: 0 };
  let wasWet = false;
  for (let step = 0; step <= steps; step += 1) {
    const fraction = step / steps;
    const wet = isBridgeWater(world, {
      x: start.x + (end.x - start.x) * fraction,
      z: start.z + (end.z - start.z) * fraction
    });
    if ((step === 0 || step === steps) && wet) return { ...profile, runs: -1 };
    if (wet && !wasWet) profile.runs += 1;
    if (wet && profile.first < 0) profile.first = length * fraction;
    if (wet) profile.last = length * fraction;
    wasWet = wet;
  }
  return profile;
};

/** Headings (half a turn in 10-degree steps) measuring the channel width at the crossing's middle. */
const WIDTH_HEADINGS = Array.from({ length: 18 }, (_, index) => ({
  x: DMath.cos(Math.PI * index / 18),
  z: DMath.sin(Math.PI * index / 18)
}));
/**
 * Longest water run a span may have against the channel's narrowest width there: about 40 degrees
 * of skew (1 / cos 40), plus sampling slack. Longer runs lie along the river instead of crossing it.
 */
const MAX_SKEW_RATIO = 1.31;
const SKEW_SLACK = 0.3;

const wetDistance = (world: BridgeWaterWorld, origin: RoadPoint, direction: RoadPoint, reach: number) => {
  let distance = 0;
  while (distance < reach &&
    isBridgeWater(world, { x: origin.x + direction.x * distance, z: origin.z + direction.z * distance }))
    distance += PROFILE_STEP;
  return distance;
};

/** Narrowest channel width through `point`, measured no further than `reach` each way. */
const narrowestWidth = (world: BridgeWaterWorld, point: RoadPoint, reach: number) =>
  WIDTH_HEADINGS.reduce((narrowest, direction) => Math.min(narrowest,
    wetDistance(world, point, direction, reach) +
    wetDistance(world, point, { x: -direction.x, z: -direction.z }, reach)), Infinity);

/** True when the span runs along the channel: its water run is far longer than the channel is wide. */
const runsAlongRiver = (world: BridgeWaterWorld, start: RoadPoint, end: RoadPoint, profile: WetProfile) => {
  const length = DMath.hypot(end.x - start.x, end.z - start.z);
  const wet = profile.last - profile.first, middle = (profile.first + profile.last) / 2 / length;
  const point = { x: start.x + (end.x - start.x) * middle, z: start.z + (end.z - start.z) * middle };
  return wet > narrowestWidth(world, point, wet) * MAX_SKEW_RATIO + SKEW_SLACK;
};

interface CellWindow {
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
}

/** Land a walker can cross: no corner of the cell holds water (a one-vertex stream still divides). */
const isDryCell = (world: BridgeWaterWorld, cellX: number, cellZ: number) => {
  const stride = world.cellsX + 1, vertex = cellZ * stride + cellX;
  return Math.max(world.waterDepth[vertex]!, world.waterDepth[vertex + 1]!,
    world.waterDepth[vertex + stride]!, world.waterDepth[vertex + stride + 1]!) <= WATER_EPSILON;
};

/** Steps (0.25 each) walked inland from an anchor to find the first fully dry cell of its bank. */
const BANK_CELL_STEPS = 8;

/** First dry cell behind the anchor, walking away from the river along the deck axis. */
const bankCell = (world: BridgeWaterWorld, window: CellWindow, anchor: RoadPoint, outward: RoadPoint) => {
  for (let step = 0; step <= BANK_CELL_STEPS; step += 1) {
    const cellX = Math.floor(anchor.x + outward.x * step * 0.25);
    const cellZ = Math.floor(anchor.z + outward.z * step * 0.25);
    if (cellX < window.minX || cellX > window.maxX || cellZ < window.minZ || cellZ > window.maxZ) return null;
    if (isDryCell(world, cellX, cellZ)) return cellZ * world.cellsX + cellX;
  }
  return null;
};

const spanWindow = (world: BridgeWaterWorld, start: RoadPoint, end: RoadPoint): CellWindow => ({
  maxX: Math.min(world.cellsX - 1, Math.ceil(Math.max(start.x, end.x) + BRIDGE_BANK_DETOUR_MARGIN)),
  maxZ: Math.min(world.cellsZ - 1, Math.ceil(Math.max(start.z, end.z) + BRIDGE_BANK_DETOUR_MARGIN)),
  minX: Math.max(0, Math.floor(Math.min(start.x, end.x) - BRIDGE_BANK_DETOUR_MARGIN)),
  minZ: Math.max(0, Math.floor(Math.min(start.z, end.z) - BRIDGE_BANK_DETOUR_MARGIN))
});

/** Four-connected flood over dry cells of the window: true when both anchors share one bank. */
const sameBank = (world: BridgeWaterWorld, start: RoadPoint, end: RoadPoint) => {
  const window = spanWindow(world, start, end);
  const length = DMath.hypot(end.x - start.x, end.z - start.z);
  const unit = { x: (end.x - start.x) / length, z: (end.z - start.z) / length };
  const seed = bankCell(world, window, start, { x: -unit.x, z: -unit.z });
  const target = bankCell(world, window, end, unit);
  if (seed === null || target === null) return true;
  const seen = new Set([seed]), queue = [seed];
  for (let head = 0; head < queue.length; head += 1) {
    const cell = queue[head]!;
    if (cell === target) return true;
    const cellX = cell % world.cellsX, cellZ = (cell - cellX) / world.cellsX;
    for (const [nextX, nextZ] of [[cellX - 1, cellZ], [cellX + 1, cellZ], [cellX, cellZ - 1], [cellX, cellZ + 1]] as const) {
      if (nextX < window.minX || nextX > window.maxX || nextZ < window.minZ || nextZ > window.maxZ) continue;
      const next = nextZ * world.cellsX + nextX;
      if (seen.has(next) || !isDryCell(world, nextX, nextZ)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
};

/**
 * Null when the straight span from `start` to `end` crosses the river: dry anchors, exactly one wet
 * stretch on the centreline that crosses the channel (not along it), and no dry land path between the
 * anchors near the span.
 */
export const bridgeBankProblem = (
  world: BridgeWaterWorld, start: RoadPoint, end: RoadPoint
): BridgeBankRejection | null => {
  if (!inBridgeBounds(world, start) || !inBridgeBounds(world, end)) return "not-across-river";
  const profile = wetProfile(world, start, end);
  if (profile.runs !== 1 || runsAlongRiver(world, start, end, profile)) return "not-across-river";
  return sameBank(world, start, end) ? "not-across-river" : null;
};

/** Save validation message for a saved deck or bridge site that does not cross this island's river. */
export const SAVED_BRIDGE_BANK_PROBLEM = "Bridge does not cross the river";

/** Every saved span must still cross the river of the island it is loaded on. */
export const savedBridgeBankProblem = (
  world: BridgeWaterWorld, spans: readonly { end: RoadPoint; start: RoadPoint }[]
) => spans.some(span => bridgeBankProblem(world, span.start, span.end)) ? SAVED_BRIDGE_BANK_PROBLEM : null;
