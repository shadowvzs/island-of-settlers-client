import { type ROAD_SPEED } from "@shared/catalog/balance";

import { DMath } from "../math/deterministic-math";
import type { WorldData } from "../world/world-data";
import type { RoadLengthField } from "./road-length-field";

export const ROAD_GRID_STEP = 0.5;
/** Dirt roads, entrance lanes and travel lanes keep the original width. */
export const ROAD_WIDTH = 0.9;
/**
 * Upgraded roads widen in place to this width (owner, 2026-10-14). Placement also reserves this
 * full stone width from the start, even while the road is dirt. Owner November3: rounded
 * approximately15% widening, rounded by the owner to0.9 dirt/1.3 paved; door openings stay unchanged.
 */
export const ROAD_STONE_WIDTH = 1.3;
export const ROAD_RESERVED_HALF_WIDTH = ROAD_STONE_WIDTH / 2;
/** Logical planting space: always kept clear for construction, never drawn as another road surface. */
export const ROAD_VERGE_WIDTH = .5;
/**
 * Roadside decor the player plants on chosen road stretches (owner 2026-11-07). Stored once per
 * road segment; the plants themselves stay deterministic from the segment's world position. Later
 * decor kinds join this list; the Road tab offers one tool per kind.
 */
export const ROAD_VERGE_KINDS = ["flowers"] as const;
export type RoadVergeKind = (typeof ROAD_VERGE_KINDS)[number];
export const isRoadVergeKind = (value: unknown): value is RoadVergeKind =>
  typeof value === "string" && (ROAD_VERGE_KINDS as readonly string[]).includes(value);
/** Road-tab tool id of one verge kind (`verge-flowers`); later kinds reuse the same mode shape. */
export type RoadVergeMode = `verge-${RoadVergeKind}`;
const ROAD_VERGE_MODE_PREFIX = "verge-";
export const roadVergeMode = (kind: RoadVergeKind): RoadVergeMode => `${ROAD_VERGE_MODE_PREFIX}${kind}`;
export const isRoadVergeMode = (value: unknown): value is RoadVergeMode =>
  typeof value === "string" && value.startsWith(ROAD_VERGE_MODE_PREFIX) &&
  isRoadVergeKind(value.slice(ROAD_VERGE_MODE_PREFIX.length));
export const roadVergeKindFromMode = (mode: RoadVergeMode): RoadVergeKind =>
  mode.slice(ROAD_VERGE_MODE_PREFIX.length) as RoadVergeKind;
/** V-R03 (owner O7): one plank per newly planted half-cell road segment, delivered by carriers. */
export const ROAD_VERGE_PLANK_COST = 1;
export const ROAD_PLACEMENT_WIDTH = ROAD_STONE_WIDTH + ROAD_VERGE_WIDTH * 2;
export const ROAD_PLACEMENT_HALF_WIDTH = ROAD_PLACEMENT_WIDTH / 2;
/** Legacy/ad-hoc doorway fallback; placed buildings supply their authored clear opening width. */
export const ROAD_DOOR_WIDTH = 0.34;
export const ROAD_DOOR_TAPER_LENGTH = 0.8;
export const ROAD_TIERS = ["dirt", "stone", "marble", "limestone", "basalt", "granite"] as const;
export type RoadTier = keyof typeof ROAD_SPEED;
export type RoadUpgradeTier = Exclude<RoadTier, "dirt">;
export type RoadUpgradePayment = (amount: number, material: RoadUpgradeTier) => boolean;
export const isRoadTier = (value: unknown): value is RoadTier =>
  typeof value === "string" && (ROAD_TIERS as readonly string[]).includes(value);
export const nextRoadTier = (tier: RoadTier): RoadUpgradeTier | undefined =>
  ROAD_TIERS[ROAD_TIERS.indexOf(tier) + 1] as RoadUpgradeTier | undefined;
export const ROAD_TIER_WIDTH: Readonly<Record<RoadTier, number>> = {
  dirt: ROAD_WIDTH, stone: ROAD_STONE_WIDTH, marble: ROAD_STONE_WIDTH,
  limestone: ROAD_STONE_WIDTH, basalt: ROAD_STONE_WIDTH, granite: ROAD_STONE_WIDTH
};
/** The clear, two-lane bridge deck width in world units (2 x the 1.3 stone road). */
export const BRIDGE_DECK_WIDTH = 2.6;
export const BRIDGE_LANE_COUNT = 2;
export const BRIDGE_KINDS = ["wood", "stone"] as const;
export type BridgeKind = (typeof BRIDGE_KINDS)[number];
export const isBridgeKind = (value: unknown): value is BridgeKind =>
  typeof value === "string" && (BRIDGE_KINDS as readonly string[]).includes(value);
/**
 * Bridge spans are measured in half-cell tiles along the deck, at any angle to the grid; the owner's
 * span limit and the per-tile cost apply to that length (see bridge-lattice.ts).
 */
export const BRIDGE_MIN_TILES = 3;
export const BRIDGE_MAX_TILES = 12;
/** The metadata every tile of one completed bridge shares in the road graph and settlement save. */
export interface BridgeTile {
  /** Stable bridge-group identity within one settlement road save. */
  id: number;
  kind: BridgeKind;
  /** Full clear deck width; the first bridge version only accepts BRIDGE_DECK_WIDTH. */
  width: number;
  /**
   * 0-based graph edge index from the first shore anchor towards the second. An axis-aligned span has
   * one half-cell edge per tile; an angled span has one primitive lattice edge per crossed grid node.
   */
  tile: number;
  /** Paid half-cell tiles: the span length along the deck, rounded up. */
  tiles: number;
  /**
   * Saved upgrade level 1–4 (panel level 2–5); absent on a level-1 bridge. Purely visual: every tile
   * of one group carries the same value.
   */
  level?: BridgeSavedLevel;
  /**
   * Removal ordered: the deck stands until the people on it have left, but no route may start over
   * it. Every tile of the group carries it.
   */
  closed?: true;
}
/** Bridges have levels 1–5 like buildings; the saved value counts the upgrades (0–4). */
export const MAX_BRIDGE_LEVEL = 5;
export type BridgeSavedLevel = 1 | 2 | 3 | 4;
export const isBridgeSavedLevel = (value: unknown): value is BridgeSavedLevel =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_BRIDGE_LEVEL - 1;
/** Upgrades completed so far (0–4). */
export const bridgeSavedLevel = (bridge: Pick<BridgeTile, "level">) => bridge.level ?? 0;
export interface BridgeCost {
  logs: number;
  planks: number;
  stone: number;
}
const BRIDGE_TILE_COST: Readonly<Record<BridgeKind, BridgeCost>> = {
  stone: { logs: 0, planks: 1, stone: 2 },
  wood: { logs: 2, planks: 1, stone: 0 }
};
export const bridgeCost = (kind: BridgeKind, tiles: number): BridgeCost => {
  const tile = BRIDGE_TILE_COST[kind];
  return { logs: tile.logs * tiles, planks: tile.planks * tiles, stone: tile.stone * tiles };
};
export interface RoadPoint {
  x: number;
  z: number;
}
/** Stable key for one undirected road graph edge (bridge groups and verge stretches match by it). */
export const roadEdgeKey = (start: RoadPoint, end: RoadPoint) =>
  [start, end].map(point => `${point.x}:${point.z}`).sort().join("/");
export interface RoadSegment {
  start: RoadPoint;
  end: RoadPoint;
  tier: RoadTier;
  /** Completed bridge tile; absent on every ordinary road, entrance lane and approach. */
  bridge?: BridgeTile;
  /**
   * Planted roadside decor (saved). Upgrades, tier inheritance and reloads keep it; removing the
   * segment drops it, so a rebuilt road starts unplanted. Never on bridges or doorway lanes.
   */
  verge?: RoadVergeKind;
  /** Visual access path has a flat end at the actual doorway. */
  doorway?: boolean;
  /** Authored clear door opening in world units; presentation only, never part of public roads. */
  doorwayWidth?: number;
  /**
   * Presentation only (never saved): fitted ribbon width at each end, narrower than the tier width
   * where an old save's building, field or prop intrudes, or where an entrance lane flares.
   */
  startWidth?: number;
  endWidth?: number;
  /** Temporary construction highlight; never stored in the public graph. */
  preview?: boolean;
}
export interface RoadPlan {
  points: RoadPoint[];
  segments: RoadSegment[];
}
export interface RoadPreview extends RoadPlan {
  start: RoadPoint;
  end: RoadPoint;
  valid: boolean;
  contextSegments?: RoadSegment[];
}
export interface RoadRoute {
  points: RoadPoint[];
  cost: number;
  length: number;
}
export type RoadRouteStatus = "found" | "no-path" | "search-limit";
/** `search-limit` means the bounded A* gave up: the pair is not proven unreachable. */
export interface RoadRouteSearch {
  status: RoadRouteStatus;
  route: RoadRoute | null;
}
/** The sortable part of a route: length and cost, without its points array. */
export interface RoadRouteSummary {
  cost: number;
  length: number;
}
/** A route lookup for callers that only sort by length/cost and never walk the points. */
export interface RoadRouteMetrics {
  status: RoadRouteStatus;
  route: RoadRouteSummary | null;
}
export interface RoadRouteStats {
  calls: number;
  hits: number;
  misses: number;
}
/**
 * Which world cells (`z * cellsX + x`) may answer `isBlocked` differently since the last `mark`;
 * null when that is unknown (never marked, or an unexplained change), so every memoized edge is stale.
 */
export interface OccupancyChanges {
  changedCells: () => readonly number[] | null;
  mark: () => void;
}
export type RoadWorld = Pick<WorldData, "cellsX" | "cellsZ" | "heights" | "blocking" | "buildRevision" | "terrainRevision">;
export interface RoadNetworkOptions {
  /** Optional construction grading check. Preview and commit must leave live terrain untouched. */
  validateGradedRoads?: (planned: readonly RoadSegment[], existing: readonly RoadSegment[]) => boolean;
  getHeight?: (x: number, z: number) => number;
  isBlocked?: (x: number, z: number) => boolean;
  /**
   * Construction only: true when a new half-cell step's reserved strip would cover a small fixed
   * obstacle the cell grid does not record (building signposts).
   */
  isStripReserved?: (start: RoadPoint, end: RoadPoint) => boolean;
  /**
   * Changes whenever `isBlocked` can answer differently. Without it, a network with `isBlocked`
   * never memoizes routes (see trackOccupancy for the settlement simulation's binding).
   */
  occupancyRevision?: () => number;
  /** Recompute every n-th route cache hit and throw on mismatch; defaults to 64 in dev and tests. */
  verifyRouteCache?: number;
}
export interface RoadNetwork {
  readonly revision: number;
  replaceSegments: (segments: readonly RoadSegment[]) => boolean;
  /** One snapshot pass, one tier per selected public edge, one revision for the batch. */
  raiseTiersWhere: (allowed: (segment: Readonly<RoadSegment>) => boolean) => number;
  addRoad: (start: RoadPoint, end: RoadPoint) => boolean;
  /** `addRoad` without its plan: the missing edges of a dirt plan this network made and nothing changed since. */
  addPlannedRoad: (plan: Pick<RoadPlan, "points">) => boolean;
  planRoad: (start: RoadPoint, end: RoadPoint) => RoadPlan | null;
  planUpgrade: (start: RoadPoint, end: RoadPoint, targetTier?: RoadUpgradeTier, buildingFlags?: readonly RoadPoint[]) => RoadPlan | null;
  /** The existing public edges on the shortest road path between two road nodes (copies). */
  planStretch: (start: RoadPoint, end: RoadPoint) => RoadSegment[] | null;
  /** Newly joined half-cell building flags share the existing upgraded junction surface. */
  inheritBuildingFlagTiers?: (buildingFlags: readonly RoadPoint[]) => boolean;
  /** A04d: walked-length lower bounds towards `end` for `route`, exact on reachability (see road-network). */
  lengthField: (end: RoadPoint) => RoadLengthField | null;
  removeRoad: (start: RoadPoint, end: RoadPoint) => boolean;
  route: (start: RoadPoint, end: RoadPoint) => RoadRoute | null;
  /** Shares `route`'s cache and verification, but returns only length/cost and copies no points. */
  routeMetrics: (start: RoadPoint, end: RoadPoint) => RoadRouteMetrics;
  searchRoute: (start: RoadPoint, end: RoadPoint) => RoadRouteSearch;
  routeStats: () => RoadRouteStats;
  /** `changes` lets an occupancy-only change recheck the memoized edges near the changed cells. */
  trackOccupancy: (revision: () => number, changes?: OccupancyChanges) => void;
  segments: () => RoadSegment[];
  speedAt: (point: RoadPoint) => number;
  stoneRoute: (start: RoadPoint, end: RoadPoint) => RoadRoute | null;
  upgradeRoad: (start: RoadPoint, end: RoadPoint, pay: RoadUpgradePayment, targetTier?: RoadUpgradeTier,
    buildingFlags?: readonly RoadPoint[]) => boolean;
}
export const snapRoadPoint = ({ x, z }: RoadPoint): RoadPoint => ({
  x: Math.round(x / ROAD_GRID_STEP) * ROAD_GRID_STEP,
  z: Math.round(z / ROAD_GRID_STEP) * ROAD_GRID_STEP
});


/** Width a segment is drawn and walked at before door tapering: entrance lanes stay dirt width. */
export const roadBaseWidth = (segment: Pick<RoadSegment, "bridge" | "doorway" | "tier">) => {
  if (segment.bridge) return segment.bridge.width;
  return segment.doorway ? ROAD_WIDTH : ROAD_TIER_WIDTH[segment.tier];
};

/** The widest `roadRibbonWidth` over the whole segment (fraction 0..1): an upper bound for spatial indexes. */
export const roadRibbonMaxWidth = (segment: RoadSegment) => {
  const base = roadBaseWidth(segment);
  const width = Math.max(segment.startWidth ?? base, segment.endWidth ?? base);
  return segment.doorway ? Math.max(width, segment.doorwayWidth ?? ROAD_DOOR_WIDTH) : width;
};

/** Rendering, grass clearance and entrance speed use the same authored portal taper. */
export const roadRibbonWidth = (segment: RoadSegment, fraction: number) => {
  const base = roadBaseWidth(segment);
  const start = segment.startWidth ?? base, end = segment.endWidth ?? base;
  const width = start + (end - start) * fraction;
  if (!segment.doorway) return width;
  const length = DMath.hypot(segment.end.x - segment.start.x, segment.end.z - segment.start.z);
  const opening = segment.doorwayWidth ?? ROAD_DOOR_WIDTH;
  return opening + (width - opening) *
    Math.min(1, Math.max(0, length * (1 - fraction) / ROAD_DOOR_TAPER_LENGTH));
};
