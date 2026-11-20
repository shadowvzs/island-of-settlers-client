import { DMath } from "../math/deterministic-math";
import {
  BRIDGE_DECK_WIDTH,
  type BridgeKind,
  bridgeSavedLevel,
  type RoadPoint,
  type RoadSegment
} from "./road-types";

/** Half of the clear two-lane deck: actors and carts may stand anywhere inside it. */
export const BRIDGE_DECK_HALF_WIDTH = BRIDGE_DECK_WIDTH / 2;
/** Railings/parapets stand just outside the clear deck; other decks and roads keep clear of them. */
export const BRIDGE_STRUCTURE_HALF_WIDTH = 1.55;
/** The first stretch of a deck sits on its own shore anchor, where the shore roads join it. */
export const BRIDGE_ANCHOR_CLEARANCE = 0.25;

/** One straight deck in world space, from the first shore anchor to the second (any angle). */
export interface BridgeDeck {
  end: RoadPoint;
  id: number;
  kind: BridgeKind;
  length: number;
  /** Saved upgrade level (0–4); visual only. */
  level: number;
  /** Removal ordered: nobody new may step onto it. */
  closed: boolean;
  start: RoadPoint;
  tiles: number;
  unitX: number;
  unitZ: number;
}

export interface DeckCoordinates {
  across: number;
  along: number;
}

/** Groups bridge edges by identity in their saved order; malformed or empty groups are skipped. */
export const bridgeDecks = (segments: readonly RoadSegment[]): BridgeDeck[] => {
  const groups = new Map<number, RoadSegment[]>();
  for (const segment of segments) {
    if (!segment.bridge) continue;
    const group = groups.get(segment.bridge.id);
    if (group) group.push(segment);
    else groups.set(segment.bridge.id, [segment]);
  }
  const decks: BridgeDeck[] = [];
  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) => a.bridge!.tile - b.bridge!.tile);
    const first = ordered[0]!, last = ordered.at(-1)!;
    const length = DMath.hypot(last.end.x - first.start.x, last.end.z - first.start.z);
    if (length < 1e-6) continue;
    decks.push({
      end: { ...last.end },
      id: first.bridge!.id,
      kind: first.bridge!.kind,
      length,
      level: bridgeSavedLevel(first.bridge!),
      closed: Boolean(first.bridge!.closed),
      start: { ...first.start },
      tiles: first.bridge!.tiles,
      unitX: (last.end.x - first.start.x) / length,
      unitZ: (last.end.z - first.start.z) / length
    });
  }
  return decks;
};

/** Distance along the deck from its first anchor, and signed distance to the left of travel. */
export const deckCoordinates = (deck: BridgeDeck, point: RoadPoint): DeckCoordinates => {
  const dx = point.x - deck.start.x, dz = point.z - deck.start.z;
  return { across: dz * deck.unitX - dx * deck.unitZ, along: dx * deck.unitX + dz * deck.unitZ };
};

/** World point at local deck coordinates. */
export const deckPoint = (deck: BridgeDeck, along: number, across: number): RoadPoint => ({
  x: deck.start.x + deck.unitX * along - deck.unitZ * across,
  z: deck.start.z + deck.unitZ * along + deck.unitX * across
});

/** True on the clear deck rectangle between both anchors (the walkable bridge surface). */
export const isOnDeck = (deck: BridgeDeck, point: RoadPoint, halfWidth = BRIDGE_DECK_HALF_WIDTH) => {
  const { across, along } = deckCoordinates(deck, point);
  return along >= 0 && along <= deck.length && Math.abs(across) <= halfWidth;
};

const samePoint = (a: RoadPoint, b: RoadPoint) => a.x === b.x && a.z === b.z;

/** A road step joining the deck at one of its shore anchors. */
export const touchesDeckAnchor = (deck: BridgeDeck, start: RoadPoint, end: RoadPoint) =>
  [start, end].some(point => samePoint(point, deck.start) || samePoint(point, deck.end));

/**
 * True when the straight segment crosses the deck rectangle widened by `halfWidth` and shortened by
 * `endClearance` at both anchors (Liang-Barsky clip in deck coordinates).
 */
export const segmentEntersDeck = (
  deck: BridgeDeck, start: RoadPoint, end: RoadPoint, halfWidth: number, endClearance = 0
) => {
  const from = deckCoordinates(deck, start), to = deckCoordinates(deck, end);
  let enter = 0, leave = 1;
  const clip = (origin: number, delta: number, minimum: number, maximum: number) => {
    if (Math.abs(delta) < 1e-12) return origin > minimum && origin < maximum;
    const first = (minimum - origin) / delta, second = (maximum - origin) / delta;
    enter = Math.max(enter, Math.min(first, second));
    leave = Math.min(leave, Math.max(first, second));
    return enter < leave - 1e-9;
  };
  return clip(from.along, to.along - from.along, endClearance, deck.length - endClearance) &&
    clip(from.across, to.across - from.across, -halfWidth, halfWidth);
};

const projectedRadius = (deck: BridgeDeck, axisX: number, axisZ: number, halfWidth: number) =>
  Math.abs(deck.unitX * axisX + deck.unitZ * axisZ) * deck.length / 2 +
  Math.abs(-deck.unitZ * axisX + deck.unitX * axisZ) * halfWidth;

/** Separating-axis test of two deck structures (clear deck plus railings). */
export const decksOverlap = (first: BridgeDeck, second: BridgeDeck, halfWidth = BRIDGE_STRUCTURE_HALF_WIDTH) => {
  const centreX = (second.start.x + second.end.x - first.start.x - first.end.x) / 2;
  const centreZ = (second.start.z + second.end.z - first.start.z - first.end.z) / 2;
  const axes = [
    [first.unitX, first.unitZ], [-first.unitZ, first.unitX],
    [second.unitX, second.unitZ], [-second.unitZ, second.unitX]
  ] as const;
  return axes.every(([axisX, axisZ]) => Math.abs(centreX * axisX + centreZ * axisZ) <
    projectedRadius(first, axisX, axisZ, halfWidth) + projectedRadius(second, axisX, axisZ, halfWidth));
};

/** Cells touched by the deck's axis-aligned bounds, widened by `halfWidth`. */
export const deckCells = (deck: BridgeDeck, cellsX: number, cellsZ: number, halfWidth: number) => {
  const minX = Math.max(0, Math.floor(Math.min(deck.start.x, deck.end.x) - halfWidth));
  const maxX = Math.min(cellsX - 1, Math.floor(Math.max(deck.start.x, deck.end.x) + halfWidth));
  const minZ = Math.max(0, Math.floor(Math.min(deck.start.z, deck.end.z) - halfWidth));
  const maxZ = Math.min(cellsZ - 1, Math.floor(Math.max(deck.start.z, deck.end.z) + halfWidth));
  const cells: number[] = [];
  for (let z = minZ; z <= maxZ; z += 1) for (let x = minX; x <= maxX; x += 1) cells.push(z * cellsX + x);
  return cells;
};

/** A public road running under or across the deck, other than the shore joins at its anchors. */
export const roadUnderDeck = (deck: BridgeDeck, segments: readonly Pick<RoadSegment, "bridge" | "end" | "start">[]) =>
  segments.some(segment => !segment.bridge && !touchesDeckAnchor(deck, segment.start, segment.end) &&
    segmentEntersDeck(deck, segment.start, segment.end, BRIDGE_STRUCTURE_HALF_WIDTH, BRIDGE_ANCHOR_CLEARANCE));
