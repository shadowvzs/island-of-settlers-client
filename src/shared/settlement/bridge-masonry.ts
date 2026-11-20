import { bridgeApproaches, type BridgeApproachPiece, bridgeFlareWidth } from "./bridge-approaches";
import { BRIDGE_DECK_HALF_WIDTH, type BridgeDeck, bridgeDecks, deckCoordinates } from "./bridge-deck";
import { type BridgeFootprint, bridgeFootprint, insideBridgeFootprint } from "./bridge-footprint";
import type { RoadSegment } from "./road-types";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * The ground every bridge occupies in the simulation (completed bridges and construction sites):
 * - the whole footprint (deck, masonry, raised shore ramps): shore work points such as the Fisher's
 *   stance never use it;
 * - the masonry wings beside the clear deck lane (parapets and abutment faces): nobody walks there.
 */
interface BridgeGround {
  buildings: number;
  decks: readonly BridgeDeck[];
  footprint: BridgeFootprint | null;
  navigation: number;
  roads: number;
  /** The road graph's segments at `roads`: a navigation-only change reuses them instead of copying again. */
  roadSegments: readonly RoadSegment[];
  /** Shore road pieces that start at an anchor: a junction there crosses the abutment top. */
  mouths: readonly BridgeApproachPiece[];
}

/** Abutments reach this far behind each anchor along the deck axis. */
const ABUTMENT_REACH = 0.36;
/** Outer face of parapets and abutments across the deck. */
const MASONRY_HALF_WIDTH = 1.6;
/** Shore road pieces starting this close to an anchor keep their way over the abutment top. */
const MOUTH_REACH = 0.5;

const caches = new WeakMap<SettlementContext, BridgeGround>();
type BridgeShapes = Pick<BridgeGround, "decks" | "footprint" | "mouths">;
const NO_GROUND: BridgeShapes = { decks: [], footprint: null, mouths: [] };

const siteSegments = (context: SettlementContext): RoadSegment[] =>
  context.buildings.flatMap(building => building.bridgeSite?.segments ?? []);

/** Rebuilt when the road graph or the buildings (bridge sites) change; a cheap check on hot paths. */
const bridgeGround = (context: SettlementContext): BridgeShapes => {
  const { roads, world } = context.options;
  const revisions = {
    buildings: context.buildings.length, navigation: context.navigationRevision ?? 0, roads: roads?.revision ?? 0
  };
  const cached = caches.get(context);
  if (cached && cached.roads === revisions.roads && cached.navigation === revisions.navigation &&
    cached.buildings === revisions.buildings) return cached;
  const roadSegments = cached && cached.roads === revisions.roads && roads?.revision !== undefined
    ? cached.roadSegments : roads?.segments?.() ?? [];
  const segments = [...roadSegments, ...siteSegments(context)];
  const shapes = segments.some(segment => segment.bridge) ? {
    decks: bridgeDecks(segments),
    footprint: bridgeFootprint(segments, world),
    mouths: bridgeApproaches(segments, MOUTH_REACH).flatMap(approach => approach.pieces)
  } : NO_GROUND;
  caches.set(context, { ...shapes, ...revisions, roadSegments });
  return shapes;
};

const inFootprintCell = (context: SettlementContext, footprint: BridgeFootprint, point: SettlementPoint) =>
  footprint.cells.has(Math.floor(point.z) * context.options.world.cellsX + Math.floor(point.x));

/** Some bridge stands or is being built (otherwise no point is on bridge masonry). */
export const hasBridgeGround = (context: SettlementContext) => Boolean(bridgeGround(context).footprint);

/** True inside any bridge's deck, masonry or shore ramp footprint. */
export const isInBridgeFootprint = (context: SettlementContext, point: SettlementPoint) => {
  const { footprint } = bridgeGround(context);
  if (!footprint || !inFootprintCell(context, footprint, point)) return false;
  return insideBridgeFootprint(footprint, point.x, point.z);
};

const onMouthRoad = (piece: BridgeApproachPiece, point: SettlementPoint) => {
  const dx = piece.to.x - piece.from.x, dz = piece.to.z - piece.from.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-12) return false;
  const fraction = Math.max(0, Math.min(1, ((point.x - piece.from.x) * dx + (point.z - piece.from.z) * dz) / lengthSquared));
  const lateralX = point.x - piece.from.x - dx * fraction, lateralZ = point.z - piece.from.z - dz * fraction;
  const distance = piece.startDistance + (piece.endDistance - piece.startDistance) * fraction;
  const half = bridgeFlareWidth(piece.segment, distance) / 2;
  return lateralX * lateralX + lateralZ * lateralZ <= half * half;
};

/**
 * True on a parapet or abutment face beside the clear deck lane; a shore road meeting the anchor
 * keeps its way over the abutment top.
 */
export const isOnBridgeMasonry = (context: SettlementContext, point: SettlementPoint) => {
  const { decks, footprint, mouths } = bridgeGround(context);
  if (!footprint || !inFootprintCell(context, footprint, point)) return false;
  const inWing = decks.some(deck => {
    const { across, along } = deckCoordinates(deck, point);
    const side = Math.abs(across);
    return along >= -ABUTMENT_REACH && along <= deck.length + ABUTMENT_REACH &&
      side > BRIDGE_DECK_HALF_WIDTH && side <= MASONRY_HALF_WIDTH;
  });
  return inWing && !mouths.some(piece => onMouthRoad(piece, point));
};
