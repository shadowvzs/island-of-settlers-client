import { DMath } from "../math/deterministic-math";
import { BRIDGE_FLARE_LENGTH } from "./bridge-approaches";
import { BRIDGE_DECK_HALF_WIDTH } from "./bridge-deck";
import { type BridgeLatticeSpan, bridgeLatticeSpan } from "./bridge-lattice";
import { type BridgeWaterWorld, inBridgeBounds, isBridgeWater } from "./bridge-river-banks";
import { BRIDGE_MAX_TILES, ROAD_GRID_STEP, type RoadPoint, snapRoadPoint } from "./road-types";

/**
 * River-normal crossing search for the bridge planner. Every result is a pure function of the world
 * layers, the injected rules and the snapped pointer, so preview, command and verifier agree.
 */
export type CrossingRejection = "ineligible-water" | "too-long" | "unsafe-shore";

export type CrossingPlanningWorld = BridgeWaterWorld;

export interface CrossingRules {
  /** Dry ground under the deck between an anchor and the water (bank slopes are allowed). */
  isClearUnderDeck?: (point: RoadPoint) => boolean;
  isEligibleWater: (point: RoadPoint) => boolean;
  isSafeShore: (point: RoadPoint) => boolean;
}

export interface Crossing {
  end: RoadPoint;
  span: BridgeLatticeSpan;
  start: RoadPoint;
}

export type CrossingResult = { crossing: Crossing; ok: true } | { ok: false; reason: CrossingRejection };

/** Half a turn in 5-degree steps: a crossing and its reverse are the same span. */
const HEADING_COUNT = 36;
const HEADINGS: readonly RoadPoint[] = Array.from({ length: HEADING_COUNT }, (_, index) => {
  const angle = Math.PI * index / HEADING_COUNT;
  return { x: DMath.cos(angle), z: DMath.sin(angle) };
});
/** Spans stay close to the river normal: at most 30 degrees of skew to dodge a blocked bank. */
const MAX_SKEW_HEADINGS = 6;
const MARCH_STEP = 0.125;
/** Bisection steps that place the waterline within 2 mm, so widths compare across headings. */
const SHORE_REFINEMENT_STEPS = 6;
/** A shore farther than the longest span plus the inland window can never be bridged. */
const MAX_REACH = BRIDGE_MAX_TILES * ROAD_GRID_STEP + 1;
/** Anchors may sit up to one cell inland of the waterline to find clear, dry ground. */
const INLAND_OFFSETS = [0, 0.25, 0.5, 0.75, 1] as const;
const FOOTPRINT_STEP = 0.25;
const FOOTPRINT_ACROSS = [-1, -0.5, 0, 0.5, 1].map(side => side * BRIDGE_DECK_HALF_WIDTH);
/** Three half-cell steps of land behind each anchor carry the flared approach. */
const APPROACH_STEPS = Math.round(BRIDGE_FLARE_LENGTH / ROAD_GRID_STEP);

interface HeadingCrossing {
  back: number;
  direction: RoadPoint;
  eligible: boolean;
  forward: number;
  index: number;
  width: number;
}

interface CandidatePair {
  end: RoadPoint;
  length: number;
  order: number;
  /** Sine of the angle between this span and the river normal. */
  skew: number;
  span: BridgeLatticeSpan;
  start: RoadPoint;
}

const along = (origin: RoadPoint, direction: RoadPoint, distance: number): RoadPoint =>
  ({ x: origin.x + direction.x * distance, z: origin.z + direction.z * distance });

/** Waterline between a wet and a dry distance on one ray. */
const refineShore = (world: CrossingPlanningWorld, origin: RoadPoint, direction: RoadPoint, dry: number) => {
  let wet = dry - MARCH_STEP;
  for (let step = 0; step < SHORE_REFINEMENT_STEPS; step += 1) {
    const middle = (wet + dry) / 2;
    if (isBridgeWater(world, along(origin, direction, middle))) wet = middle;
    else dry = middle;
  }
  return dry;
};

/** Distance to the waterline, and whether every water sample on the way is eligible. */
const marchToShore = (
  world: CrossingPlanningWorld, rules: CrossingRules, origin: RoadPoint, direction: RoadPoint
) => {
  let eligible = rules.isEligibleWater(origin);
  for (let step = 1; step * MARCH_STEP <= MAX_REACH; step += 1) {
    const point = along(origin, direction, step * MARCH_STEP);
    if (!inBridgeBounds(world, point)) return null;
    if (!isBridgeWater(world, point))
      return { distance: refineShore(world, origin, direction, step * MARCH_STEP), eligible };
    eligible &&= rules.isEligibleWater(point);
  }
  return null;
};

const headingCrossing = (
  world: CrossingPlanningWorld, rules: CrossingRules, origin: RoadPoint, index: number
): HeadingCrossing | null => {
  const direction = HEADINGS[index]!;
  const forward = marchToShore(world, rules, origin, direction);
  const back = forward && marchToShore(world, rules, origin, { x: -direction.x, z: -direction.z });
  if (!forward || !back) return null;
  return {
    back: back.distance,
    direction,
    eligible: forward.eligible && back.eligible,
    forward: forward.distance,
    index,
    width: forward.distance + back.distance
  };
};

const headingSkew = (first: number, second: number) => {
  const difference = Math.abs(first - second) % HEADING_COUNT;
  return Math.min(difference, HEADING_COUNT - difference);
};

/** Headings within the skew limit of the narrowest crossing, narrowest first. */
const crossingHeadings = (world: CrossingPlanningWorld, rules: CrossingRules, origin: RoadPoint) => {
  const found = HEADINGS.flatMap((_, index) => headingCrossing(world, rules, origin, index) ?? []);
  if (!found.length) return null;
  const normal = found.reduce((best, crossing) => crossing.width < best.width ? crossing : best);
  return found.filter(crossing => headingSkew(crossing.index, normal.index) <= MAX_SKEW_HEADINGS)
    .sort((a, b) => a.width - b.width || a.index - b.index);
};

/** Grid anchors from the waterline up to one cell inland, nearest the water first. */
const shoreAnchors = (origin: RoadPoint, direction: RoadPoint, distance: number) => {
  const anchors: RoadPoint[] = [];
  for (const offset of INLAND_OFFSETS) {
    const anchor = snapRoadPoint(along(origin, direction, distance + offset));
    if (!anchors.some(other => other.x === anchor.x && other.z === anchor.z)) anchors.push(anchor);
  }
  return anchors;
};

/** Skew bands (sine of the angle to the river normal): about 13 and 22 degrees. */
const SKEW_BANDS = [0.22, 0.38] as const;
const skewBand = (skew: number) => SKEW_BANDS.filter(limit => skew > limit).length;

/**
 * A span follows the river first: the best-aligned band wins, then the cheapest (paid tiles) within
 * it, then the least skew and the shortest deck.
 */
const comparePairs = (a: CandidatePair, b: CandidatePair) =>
  skewBand(a.skew) - skewBand(b.skew) || a.span.tiles - b.span.tiles || a.skew - b.skew ||
  a.length - b.length || a.order - b.order;

const candidatePairs = (headings: readonly HeadingCrossing[], origin: RoadPoint) => {
  const pairs: CandidatePair[] = [];
  const seen = new Set<string>();
  const normal = headings[0]!.direction;
  for (const heading of headings) {
    const backward = { x: -heading.direction.x, z: -heading.direction.z };
    for (const start of shoreAnchors(origin, backward, heading.back))
      for (const end of shoreAnchors(origin, heading.direction, heading.forward)) {
        const key = `${start.x}:${start.z}/${end.x}:${end.z}`;
        const span = bridgeLatticeSpan(start, end);
        if (seen.has(key) || !span) continue;
        seen.add(key);
        const dx = end.x - start.x, dz = end.z - start.z, length = DMath.hypot(dx, dz);
        const skew = Math.abs(dx * normal.z - dz * normal.x) / length;
        pairs.push({ end, length, order: pairs.length, skew, span, start });
      }
  }
  return pairs.sort(comparePairs);
};

/** Water under the deck must be river; dry ground under it must be clear of plots, props and cliffs. */
const footprintProblem = (
  world: CrossingPlanningWorld, rules: CrossingRules, pair: CandidatePair
): CrossingRejection | null => {
  const unit = { x: (pair.end.x - pair.start.x) / pair.length, z: (pair.end.z - pair.start.z) / pair.length };
  const steps = Math.max(1, Math.ceil(pair.length / FOOTPRINT_STEP));
  let crossesWater = false;
  for (let step = 0; step <= steps; step += 1) {
    const centre = along(pair.start, unit, pair.length * step / steps);
    for (const across of FOOTPRINT_ACROSS) {
      const point = { x: centre.x - unit.z * across, z: centre.z + unit.x * across };
      if (!inBridgeBounds(world, point)) return "unsafe-shore";
      if (!isBridgeWater(world, point)) {
        if (!(rules.isClearUnderDeck?.(point) ?? true)) return "unsafe-shore";
        continue;
      }
      if (!rules.isEligibleWater(point)) return "ineligible-water";
      crossesWater ||= across === 0;
    }
  }
  return crossesWater ? null : "unsafe-shore";
};

/** The anchor and the straight land approach behind it, along the deck axis. */
const approachClear = (
  world: CrossingPlanningWorld, rules: CrossingRules, anchor: RoadPoint, outward: RoadPoint
) => {
  for (let step = 0; step <= APPROACH_STEPS; step += 1) {
    const point = snapRoadPoint(along(anchor, outward, step * ROAD_GRID_STEP));
    if (!inBridgeBounds(world, point) || !rules.isSafeShore(point)) return false;
  }
  return true;
};

const pairProblem = (
  world: CrossingPlanningWorld, rules: CrossingRules, pair: CandidatePair
): CrossingRejection | null => {
  const unit = { x: (pair.end.x - pair.start.x) / pair.length, z: (pair.end.z - pair.start.z) / pair.length };
  if (!approachClear(world, rules, pair.start, { x: -unit.x, z: -unit.z }) ||
    !approachClear(world, rules, pair.end, unit)) return "unsafe-shore";
  return footprintProblem(world, rules, pair);
};

/**
 * Finds the river normal through the pointer (the narrowest of 36 headings), then the best-aligned,
 * cheapest pair of grid anchors on safe, dry land whose straight deck crosses only eligible river
 * water. Length limits are applied by the caller to that crossing: a too narrow stream is refused
 * rather than skewed into a longer span.
 */
export const findBridgeCrossing = (
  world: CrossingPlanningWorld, rules: CrossingRules, origin: RoadPoint
): CrossingResult => {
  const headings = crossingHeadings(world, rules, origin);
  if (!headings) return { ok: false, reason: "too-long" };
  const eligible = headings.filter(heading => heading.eligible);
  if (!eligible.length) return { ok: false, reason: "ineligible-water" };
  let firstProblem: CrossingRejection | null = null;
  for (const pair of candidatePairs(eligible, origin)) {
    const problem = pairProblem(world, rules, pair);
    if (!problem) return { crossing: { end: pair.end, span: pair.span, start: pair.start }, ok: true };
    firstProblem ??= problem;
  }
  return { ok: false, reason: firstProblem ?? "unsafe-shore" };
};
