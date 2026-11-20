import { DMath } from "../math/deterministic-math";
import { sampleBilinear } from "../world/grid-geometry";
import { BRIDGE_FLARE_LENGTH } from "./bridge-approaches";
import {
  type Crossing,
  type CrossingRules,
  findBridgeCrossing
} from "./bridge-crossing-search";
import { bridgeLatticeNodes } from "./bridge-lattice";
import { bridgeBankProblem, isBridgeWater } from "./bridge-river-banks";
import { bridgeStepProblem, type BridgeStepWorld } from "./bridge-water-steps";
import {
  BRIDGE_DECK_WIDTH,
  BRIDGE_LANE_COUNT,
  BRIDGE_MAX_TILES,
  BRIDGE_MIN_TILES,
  type BridgeCost,
  bridgeCost,
  type BridgeKind,
  isBridgeKind,
  ROAD_STONE_WIDTH,
  ROAD_WIDTH,
  type RoadPoint,
  type RoadSegment,
  snapRoadPoint
} from "./road-types";

const SELECTED_BANK_REACH = 2.5;
/** Matches the sea/river split used by world generation's distance fields. */
const SEA_RIVER_DISTANCE = 2.5;

/** World layers the pure bridge planner reads; gameplay eligibility stays in the injected rules. */
export interface BridgePlanningWorld extends BridgeStepWorld {
  riverDistance?: Float32Array;
}

export interface BridgePlanningRules extends CrossingRules {
  /** True only for an inland river crossing, never for open sea or arbitrary water. */
  isEligibleWater: (point: RoadPoint) => boolean;
  /** Dry, clear land for one anchor and the approach immediately behind it. */
  isSafeShore: (point: RoadPoint) => boolean;
}

export interface BridgePlanningRequest {
  /** Connect the selected bank to the span; the opposite shore anchor is derived. */
  bank?: RoadPoint;
  /** Stable group identity supplied by the future construction command. */
  id: number;
  kind: BridgeKind;
  pointer: RoadPoint;
  /** Existing connecting road width; the flare never widens the deck beyond 2.6. */
  approachWidth?: number;
  rules: BridgePlanningRules;
  world: BridgePlanningWorld;
}

export interface BridgeApproachFlare {
  anchor: RoadPoint;
  innerWidth: number;
  outer: RoadPoint;
  outerWidth: number;
}

export interface BridgePlan {
  approaches: readonly [BridgeApproachFlare, BridgeApproachFlare];
  cost: BridgeCost;
  deckWidth: number;
  end: RoadPoint;
  kind: BridgeKind;
  lanes: number;
  segments: RoadSegment[];
  start: RoadPoint;
  tiles: number;
}

export type BridgePlanRejection =
  | "across-water-step"
  | "ineligible-water"
  | "invalid-approach-width"
  | "invalid-id"
  | "invalid-kind"
  | "invalid-pointer"
  | "not-across-river"
  | "not-over-water"
  | "selected-bank-too-far"
  | "too-long"
  | "too-short"
  | "unsafe-shore";

export type BridgePlanResult =
  | { ok: true; plan: BridgePlan }
  | { ok: false; reason: BridgePlanRejection };

const finitePoint = (point: RoadPoint | undefined) =>
  Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.z));

/** The span leaves from the selected bank; without one it keeps the search's order. */
const orientCrossing = (crossing: Crossing, bank: RoadPoint | undefined): Crossing => {
  if (!bank) return crossing;
  const distanceToStart = DMath.hypot(bank.x - crossing.start.x, bank.z - crossing.start.z);
  const distanceToEnd = DMath.hypot(bank.x - crossing.end.x, bank.z - crossing.end.z);
  if (distanceToEnd >= distanceToStart) return crossing;
  const span = { ...crossing.span, stepX: -crossing.span.stepX, stepZ: -crossing.span.stepZ };
  return { end: crossing.start, span, start: crossing.end };
};

/** One road-graph edge per primitive lattice step between the anchors, all sharing the bridge identity. */
const bridgeSegments = (request: BridgePlanningRequest, crossing: Crossing): RoadSegment[] => {
  const nodes = bridgeLatticeNodes(crossing.start, crossing.span);
  return nodes.slice(1).map((end, tile) => ({
    start: nodes[tile]!,
    end,
    tier: request.kind === "wood" ? "dirt" : "stone",
    bridge: {
      id: request.id,
      kind: request.kind,
      width: BRIDGE_DECK_WIDTH,
      tile,
      tiles: crossing.span.tiles
    }
  }));
};

const approachFlares = (crossing: Crossing, approachWidth: number) => {
  const length = DMath.hypot(crossing.end.x - crossing.start.x, crossing.end.z - crossing.start.z);
  const unit = { x: (crossing.end.x - crossing.start.x) / length, z: (crossing.end.z - crossing.start.z) / length };
  const outer = (anchor: RoadPoint, direction: -1 | 1) => snapRoadPoint({
    x: anchor.x + unit.x * direction * BRIDGE_FLARE_LENGTH,
    z: anchor.z + unit.z * direction * BRIDGE_FLARE_LENGTH
  });
  return [
    { anchor: { ...crossing.start }, innerWidth: BRIDGE_DECK_WIDTH, outer: outer(crossing.start, -1),
      outerWidth: approachWidth },
    { anchor: { ...crossing.end }, innerWidth: BRIDGE_DECK_WIDTH, outer: outer(crossing.end, 1),
      outerWidth: approachWidth }
  ] as const;
};

const requestProblem = (request: BridgePlanningRequest): BridgePlanRejection | null => {
  const { approachWidth = ROAD_STONE_WIDTH, bank, id, kind, pointer } = request;
  if (!isBridgeKind(kind)) return "invalid-kind";
  if (!Number.isSafeInteger(id) || id < 0) return "invalid-id";
  if (!finitePoint(pointer) || (bank && !finitePoint(bank))) return "invalid-pointer";
  if (!Number.isFinite(approachWidth) || approachWidth < ROAD_WIDTH ||
    approachWidth > BRIDGE_DECK_WIDTH) return "invalid-approach-width";
  return null;
};

const bankProblem = (request: BridgePlanningRequest, crossing: Crossing): BridgePlanRejection | null => {
  const { bank, rules } = request;
  if (!bank) return null;
  if (!rules.isSafeShore(bank)) return "unsafe-shore";
  const distance = DMath.hypot(bank.x - crossing.start.x, bank.z - crossing.start.z);
  return distance > SELECTED_BANK_REACH ? "selected-bank-too-far" : null;
};

const spanLengthProblem = (crossing: Crossing): BridgePlanRejection | null => {
  if (crossing.span.tiles < BRIDGE_MIN_TILES) return "too-short";
  return crossing.span.tiles > BRIDGE_MAX_TILES ? "too-long" : null;
};

/** True for fresh water that still lies in a river bed; open sea is farther than 2.5 cells. */
export const riverWaterEligibility = (world: BridgePlanningWorld) => (point: RoadPoint) => {
  if (!isBridgeWater(world, point)) return false;
  if (!world.riverDistance) return true;
  return sampleBilinear(world, world.riverDistance, point.x, point.z) <= SEA_RIVER_DISTANCE;
};

/**
 * Plans a straight two-lane span at any angle to the grid, with both shore flares, without mutating
 * the world or road graph. Tiles and cost are measured along the deck.
 */
export const planBridge = (request: BridgePlanningRequest): BridgePlanResult => {
  const invalid = requestProblem(request);
  if (invalid) return { ok: false, reason: invalid };
  const { approachWidth = ROAD_STONE_WIDTH, bank, kind, pointer, rules, world } = request;
  const origin = snapRoadPoint(pointer);
  if (!isBridgeWater(world, origin)) return { ok: false, reason: "not-over-water" };
  const found = findBridgeCrossing(world, rules, origin);
  if (!found.ok) return { ok: false, reason: found.reason };
  const crossing = orientCrossing(found.crossing, bank);
  // Length first: a stream too narrow for the minimum span is "too short", not "not a crossing".
  const problem = bankProblem(request, crossing) ?? spanLengthProblem(crossing) ??
    bridgeBankProblem(world, crossing.start, crossing.end) ?? bridgeStepProblem(world, crossing.start, crossing.end);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, plan: {
    approaches: approachFlares(crossing, approachWidth),
    cost: bridgeCost(kind, crossing.span.tiles),
    deckWidth: BRIDGE_DECK_WIDTH,
    end: { ...crossing.end },
    kind,
    lanes: BRIDGE_LANE_COUNT,
    segments: bridgeSegments(request, crossing),
    start: { ...crossing.start },
    tiles: crossing.span.tiles
  } };
};
