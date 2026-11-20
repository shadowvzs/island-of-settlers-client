import { bridgeLatticeSpan, isBridgeLatticeEdge } from "./bridge-lattice";
import {
  BRIDGE_DECK_WIDTH,
  BRIDGE_MAX_TILES,
  BRIDGE_MIN_TILES,
  bridgeSavedLevel,
  type BridgeTile,
  isBridgeKind,
  isBridgeSavedLevel,
  type RoadPoint,
  type RoadSegment
} from "./road-types";

const samePoint = (a: RoadPoint, b: RoadPoint) => a.x === b.x && a.z === b.z;

const bridgeTileProblem = (bridge: BridgeTile): string | null => {
  if (!Number.isSafeInteger(bridge.id) || bridge.id < 0) return "Invalid bridge identity";
  if (!isBridgeKind(bridge.kind)) return "Invalid bridge kind";
  if (bridge.width !== BRIDGE_DECK_WIDTH) return "Invalid bridge deck width";
  if (!Number.isSafeInteger(bridge.tiles) || bridge.tiles < BRIDGE_MIN_TILES ||
    bridge.tiles > BRIDGE_MAX_TILES) return "Invalid bridge span length";
  if (!Number.isSafeInteger(bridge.tile) || bridge.tile < 0 || bridge.tile >= bridge.tiles)
    return "Invalid bridge tile index";
  if (bridge.level !== undefined && !isBridgeSavedLevel(bridge.level)) return "Invalid bridge level";
  if (bridge.closed !== undefined && bridge.closed !== true) return "Invalid bridge closure";
  return null;
};

interface BridgeGroup {
  kind: BridgeTile["kind"];
  level: number;
  closed: boolean;
  tiles: BridgeTile["tiles"];
  width: number;
  byTile: Map<number, RoadSegment>;
}

const sameStep = (segment: RoadSegment, first: RoadSegment) =>
  segment.end.x - segment.start.x === first.end.x - first.start.x &&
  segment.end.z - segment.start.z === first.end.z - first.start.z;

/**
 * A span is a contiguous run of identical primitive lattice edges between its two grid anchors; its
 * saved tile count is the deck length measured along that (possibly angled) span.
 */
const groupProblem = (group: BridgeGroup): string | null => {
  const ordered: RoadSegment[] = [];
  for (let tile = 0; tile < group.byTile.size; tile += 1) {
    const segment = group.byTile.get(tile);
    if (!segment) return "Incomplete bridge span";
    ordered.push(segment);
  }
  const first = ordered[0]!;
  for (let tile = 0; tile < ordered.length; tile += 1) {
    const current = ordered[tile]!, previous = ordered[tile - 1];
    if (!isBridgeLatticeEdge(current.start, current.end) || !sameStep(current, first) ||
      (previous && !samePoint(previous.end, current.start))) return "Bridge span is not a straight contiguous run";
  }
  const span = bridgeLatticeSpan(first.start, ordered.at(-1)!.end);
  if (!span || span.edges !== ordered.length || span.tiles !== group.tiles) return "Incomplete bridge span";
  return null;
};

/** Rejects malformed or inconsistent bridge metadata before a road network or save is accepted. */
export const bridgeRoadProblem = (segments: readonly RoadSegment[]): string | null => {
  const groups = new Map<number, BridgeGroup>();
  for (const segment of segments) {
    if (!segment || !segment.bridge) continue;
    const problem = bridgeTileProblem(segment.bridge);
    if (problem) return problem;
    if (segment.doorway || segment.preview) return "Bridge tiles cannot be doorway or preview roads";
    const previous = groups.get(segment.bridge.id);
    if (previous && (previous.kind !== segment.bridge.kind ||
      previous.tiles !== segment.bridge.tiles || previous.width !== segment.bridge.width ||
      previous.level !== bridgeSavedLevel(segment.bridge) || previous.closed !== Boolean(segment.bridge.closed)))
      return "Inconsistent bridge span metadata";
    const group = previous ?? {
      kind: segment.bridge.kind,
      level: bridgeSavedLevel(segment.bridge),
      closed: Boolean(segment.bridge.closed),
      tiles: segment.bridge.tiles,
      width: segment.bridge.width,
      byTile: new Map<number, RoadSegment>()
    };
    if (group.byTile.has(segment.bridge.tile)) return "Duplicate bridge tile";
    group.byTile.set(segment.bridge.tile, segment);
    groups.set(segment.bridge.id, group);
  }
  for (const group of groups.values()) {
    const problem = groupProblem(group);
    if (problem) return problem;
  }
  return null;
};

/** Copies the public bridge identity so callers cannot mutate the road graph through a snapshot. */
export const copyBridgeTile = (bridge: BridgeTile): BridgeTile => ({ ...bridge });

/** Stable groups for demolition/removal: deleting any tile releases the complete span. */
export const bridgeTiles = (segments: readonly RoadSegment[], id: number): RoadSegment[] =>
  segments.filter(segment => segment.bridge?.id === id);
