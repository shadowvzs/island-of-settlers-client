import {
  BRIDGE_MAX_RAMP_LENGTH,
  bridgeApproaches,
  type BridgeApproachPiece,
  bridgeFlareWidth
} from "./bridge-approaches";
import { type BridgeDeck, bridgeDecks, deckCoordinates } from "./bridge-deck";
import type { RoadSegment } from "./road-types";

/**
 * Ground a bridge occupies for vegetation: the deck with its railings/parapets and abutments, plus
 * the shore ramps up to their longest length (the flared shore roads, or the deck axis when no road
 * meets an anchor yet). Plants, reeds and grass tufts never grow inside it, for completed bridges and
 * construction sites alike. Pure and deterministic; cell bounds keep lookups cheap.
 */
export interface BridgeFootprint {
  decks: readonly BridgeDeck[];
  /** Cells (z * cellsX + x) whose area the footprint touches. */
  cells: ReadonlySet<number>;
  ramps: readonly BridgeApproachPiece[];
  /** Axis landings of anchors without a shore road: anchor, outward unit and deck. */
  landings: readonly { deck: BridgeDeck; start: boolean }[];
}

/** Outside the clear deck: parapets/railings (1.55) plus a small margin. */
export const BRIDGE_FOOTPRINT_HALF_WIDTH = 1.8;
/** Abutments and their footings reach this far behind each anchor. */
const ABUTMENT_REACH = 0.6;
/** Longest shore ramp (`bridge-surface` blends the deck down to the ground over at most this). */
export const BRIDGE_RAMP_REACH = BRIDGE_MAX_RAMP_LENGTH;
/** Axis landing of an anchor without a shore road (inside the field cover rebuild margin). */
const LANDING_REACH = 3;
/** Bare margin beside a ramp's drawn ribbon. */
const RAMP_MARGIN = 0.2;

const insideDeck = (deck: BridgeDeck, x: number, z: number) => {
  const { across, along } = deckCoordinates(deck, { x, z });
  return along >= -ABUTMENT_REACH && along <= deck.length + ABUTMENT_REACH &&
    Math.abs(across) <= BRIDGE_FOOTPRINT_HALF_WIDTH;
};

const insideRamp = (piece: BridgeApproachPiece, x: number, z: number) => {
  const dx = piece.to.x - piece.from.x, dz = piece.to.z - piece.from.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-12) return false;
  const fraction = Math.max(0, Math.min(1, ((x - piece.from.x) * dx + (z - piece.from.z) * dz) / lengthSquared));
  const distance = piece.startDistance + (piece.endDistance - piece.startDistance) * fraction;
  if (distance > BRIDGE_RAMP_REACH) return false;
  const lateralX = x - piece.from.x - dx * fraction, lateralZ = z - piece.from.z - dz * fraction;
  const half = bridgeFlareWidth(piece.segment, distance) / 2 + RAMP_MARGIN;
  return lateralX * lateralX + lateralZ * lateralZ <= half * half;
};

const insideLanding = ({ deck, start }: BridgeFootprint["landings"][number], x: number, z: number) => {
  const { across, along } = deckCoordinates(deck, { x, z });
  const outward = start ? -along : along - deck.length;
  return outward >= 0 && outward <= LANDING_REACH && Math.abs(across) <= BRIDGE_FOOTPRINT_HALF_WIDTH;
};

/** True inside any part of the footprint. */
export const insideBridgeFootprint = (footprint: BridgeFootprint, x: number, z: number) =>
  footprint.decks.some(deck => insideDeck(deck, x, z)) ||
  footprint.ramps.some(piece => insideRamp(piece, x, z)) ||
  footprint.landings.some(landing => insideLanding(landing, x, z));

const addBounds = (
  cells: Set<number>, grid: { cellsX: number; cellsZ: number },
  minX: number, maxX: number, minZ: number, maxZ: number
) => {
  for (let z = Math.max(0, Math.floor(minZ)); z <= Math.min(grid.cellsZ - 1, Math.floor(maxZ)); z += 1)
    for (let x = Math.max(0, Math.floor(minX)); x <= Math.min(grid.cellsX - 1, Math.floor(maxX)); x += 1)
      cells.add(z * grid.cellsX + x);
};

/**
 * Footprint of every bridge deck in `segments` (completed roads and construction-site orders), with
 * the shore roads in the same list carrying the ramps. Null when there is no bridge.
 */
export const bridgeFootprint = (
  segments: readonly RoadSegment[], grid: { cellsX: number; cellsZ: number }
): BridgeFootprint | null => {
  const decks = bridgeDecks(segments);
  if (!decks.length) return null;
  const ramps: BridgeApproachPiece[] = [], landings: BridgeFootprint["landings"][number][] = [];
  for (const approach of bridgeApproaches(segments, BRIDGE_RAMP_REACH)) {
    if (approach.pieces.length) ramps.push(...approach.pieces);
    else landings.push({ deck: approach.deck, start: approach.anchor === approach.deck.start });
  }
  const cells = new Set<number>();
  const reach = Math.max(BRIDGE_FOOTPRINT_HALF_WIDTH, ABUTMENT_REACH) + BRIDGE_RAMP_REACH;
  for (const deck of decks)
    addBounds(cells, grid, Math.min(deck.start.x, deck.end.x) - reach, Math.max(deck.start.x, deck.end.x) + reach,
      Math.min(deck.start.z, deck.end.z) - reach, Math.max(deck.start.z, deck.end.z) + reach);
  return { cells, decks, landings, ramps };
};
