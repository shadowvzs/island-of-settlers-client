import { DMath } from "../math/deterministic-math";
import { type BridgeDeck, bridgeDecks } from "./bridge-deck";
import { BRIDGE_DECK_WIDTH, roadBaseWidth, type RoadPoint, type RoadSegment } from "./road-types";

/** The connecting road widens from its own width to the two-lane deck over this road length. */
export const BRIDGE_FLARE_LENGTH = 1.5;
/** Longest shore ramp: `bridge-surface` blends a high deck down to the ground over at most this. */
export const BRIDGE_MAX_RAMP_LENGTH = 6;

/** One shore road edge walked outward from a bridge anchor, with its road distance from the anchor. */
export interface BridgeApproachPiece {
  endDistance: number;
  from: RoadPoint;
  segment: RoadSegment;
  startDistance: number;
  to: RoadPoint;
}

const pointKey = (point: RoadPoint) => `${point.x}:${point.z}`;
const isShoreRoad = (segment: RoadSegment) => !segment.bridge && !segment.doorway && !segment.preview;

const shoreAdjacency = (segments: readonly RoadSegment[]) => {
  const adjacency = new Map<string, RoadSegment[]>();
  for (const segment of segments) {
    if (!isShoreRoad(segment)) continue;
    for (const point of [segment.start, segment.end]) {
      const list = adjacency.get(pointKey(point));
      if (list) list.push(segment);
      else adjacency.set(pointKey(point), [segment]);
    }
  }
  return adjacency;
};

/**
 * Every public shore road edge within `reach` road distance of the anchor, walked outward in
 * breadth-first order. Junctions branch; each edge appears once, from its nearer end.
 */
const approachPieces = (
  adjacency: ReadonlyMap<string, readonly RoadSegment[]>, anchor: RoadPoint, reach: number
) => {
  const pieces: BridgeApproachPiece[] = [];
  const distances = new Map([[pointKey(anchor), 0]]);
  const used = new Set<RoadSegment>();
  const queue: RoadPoint[] = [anchor];
  for (let head = 0; head < queue.length; head += 1) {
    const from = queue[head]!, startDistance = distances.get(pointKey(from))!;
    if (startDistance >= reach) continue;
    for (const segment of adjacency.get(pointKey(from)) ?? []) {
      if (used.has(segment)) continue;
      used.add(segment);
      const to = pointKey(segment.start) === pointKey(from) ? segment.end : segment.start;
      const endDistance = startDistance + DMath.hypot(to.x - from.x, to.z - from.z);
      pieces.push({ endDistance, from, segment, startDistance, to });
      if (distances.has(pointKey(to))) continue;
      distances.set(pointKey(to), endDistance);
      queue.push(to);
    }
  }
  return pieces;
};

export interface BridgeApproach {
  anchor: RoadPoint;
  deck: BridgeDeck;
  pieces: BridgeApproachPiece[];
  /** Outward along the deck axis at this anchor. */
  outward: RoadPoint;
}

/** Both shore approaches of every completed bridge in the road list. */
export const bridgeApproaches = (segments: readonly RoadSegment[], reach = BRIDGE_FLARE_LENGTH) => {
  const decks = bridgeDecks(segments);
  if (!decks.length) return [];
  const adjacency = shoreAdjacency(segments);
  return decks.flatMap((deck): BridgeApproach[] => [
    { anchor: deck.start, deck, outward: { x: -deck.unitX, z: -deck.unitZ },
      pieces: approachPieces(adjacency, deck.start, reach) },
    { anchor: deck.end, deck, outward: { x: deck.unitX, z: deck.unitZ },
      pieces: approachPieces(adjacency, deck.end, reach) }
  ]);
};

/** Ribbon width of a shore road at `distance` from the anchor: the full deck, narrowing to the road. */
export const bridgeFlareWidth = (segment: RoadSegment, distance: number) => {
  const road = roadBaseWidth(segment);
  const fraction = Math.min(1, Math.max(0, distance / BRIDGE_FLARE_LENGTH));
  return BRIDGE_DECK_WIDTH + (road - BRIDGE_DECK_WIDTH) * fraction;
};

const widthAt = (piece: BridgeApproachPiece, atStart: boolean) => {
  const forward = pointKey(piece.segment.start) === pointKey(piece.from);
  const distance = forward === atStart ? piece.startDistance : piece.endDistance;
  return bridgeFlareWidth(piece.segment, distance);
};

/**
 * Presentation: widens the shore roads that meet each completed deck from 2.6 at the anchor down to
 * their own width 1.5 road units away. Fitted widths are never narrowed, only widened.
 */
export const flareBridgeApproaches = (segments: readonly RoadSegment[]): RoadSegment[] => {
  const flared = new Map<RoadSegment, { endWidth: number; startWidth: number }>();
  for (const approach of bridgeApproaches(segments))
    for (const piece of approach.pieces) {
      if (piece.startDistance >= BRIDGE_FLARE_LENGTH) continue;
      const previous = flared.get(piece.segment);
      flared.set(piece.segment, {
        endWidth: Math.max(previous?.endWidth ?? 0, widthAt(piece, false)),
        startWidth: Math.max(previous?.startWidth ?? 0, widthAt(piece, true))
      });
    }
  if (!flared.size) return segments.slice();
  return segments.map(segment => {
    const widths = flared.get(segment);
    if (!widths) return segment;
    const base = roadBaseWidth(segment);
    return {
      ...segment,
      endWidth: Math.max(segment.endWidth ?? base, widths.endWidth),
      startWidth: Math.max(segment.startWidth ?? base, widths.startWidth)
    };
  });
};
