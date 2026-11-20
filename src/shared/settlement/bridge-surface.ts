import {
  BRIDGE_FLARE_LENGTH,
  BRIDGE_MAX_RAMP_LENGTH,
  type BridgeApproach,
  bridgeApproaches,
  type BridgeApproachPiece,
  bridgeFlareWidth
} from "./bridge-approaches";
import { BRIDGE_DECK_HALF_WIDTH, type BridgeDeck, bridgeDecks, deckCoordinates } from "./bridge-deck";
import {
  BRIDGE_LANE_COUNT,
  type BridgeKind,
  ROAD_STONE_WIDTH,
  type RoadPoint,
  type RoadSegment
} from "./road-types";

/** Clear height every deck keeps above the local water surface. */
export const BRIDGE_MIN_FREEBOARD = 0.45;
/** Rises the deck at mid-span: this much per bridge tile. */
export const BRIDGE_CAMBER_PER_TILE = 0.04;
/** Authoring length of the lateral road flare on each shore. */
export const BRIDGE_APPROACH_FLARE = BRIDGE_FLARE_LENGTH;
/** Steepest permitted approach ramp rise over run. */
export const BRIDGE_MAX_RAMP_SLOPE = 1 / 6;
/** Longest ramp a very low bank may need; the shore roads carry it. */
const MAX_RAMP_LENGTH = BRIDGE_MAX_RAMP_LENGTH;

export interface BridgeSurfaceProfile {
  /** Deck top at the first and last anchor before camber. */
  baseHeight: number;
  /** Extra height at mid-span (`BRIDGE_CAMBER_PER_TILE * tiles`). */
  camber: number;
  end: RoadPoint;
  halfWidth: number;
  id: number;
  kind: BridgeKind;
  lanes: number;
  length: number;
  /** Saved upgrade level (0–4): visual detail only, never the walking surface. */
  level: number;
  /** Unit vector from `start` to `end`. */
  unit: RoadPoint;
  start: RoadPoint;
  tiles: number;
  /** Longest water surface sampled under the span. */
  waterHeight: number;
}

export type BridgeHeightLookup = (x: number, z: number) => number | undefined;
type HeightField = (x: number, z: number) => number;

const maximumWater = (deck: BridgeDeck, waterHeight: HeightField) => {
  const samples = Math.max(2, Math.ceil(deck.length / 0.5));
  let maximum = Number.NEGATIVE_INFINITY;
  for (let sample = 0; sample <= samples; sample += 1) {
    const fraction = sample / samples;
    maximum = Math.max(maximum, waterHeight(
      deck.start.x + (deck.end.x - deck.start.x) * fraction,
      deck.start.z + (deck.end.z - deck.start.z) * fraction
    ));
  }
  return maximum;
};

const deckProfile = (deck: BridgeDeck, terrainHeight: HeightField, waterHeight: HeightField) => {
  const shoreHeight = Math.max(terrainHeight(deck.start.x, deck.start.z), terrainHeight(deck.end.x, deck.end.z));
  const water = maximumWater(deck, waterHeight);
  return {
    baseHeight: Math.max(shoreHeight, water + BRIDGE_MIN_FREEBOARD),
    camber: BRIDGE_CAMBER_PER_TILE * deck.tiles,
    end: deck.end,
    halfWidth: BRIDGE_DECK_HALF_WIDTH,
    id: deck.id,
    kind: deck.kind,
    lanes: BRIDGE_LANE_COUNT,
    length: deck.length,
    level: deck.level,
    start: deck.start,
    tiles: deck.tiles,
    unit: { x: deck.unitX, z: deck.unitZ },
    waterHeight: water
  };
};

/** Builds one deck profile per completed bridge group, at any angle; malformed groups are ignored. */
export const createBridgeSurfaceProfiles = (
  segments: readonly RoadSegment[],
  terrainHeight: HeightField,
  waterHeight: HeightField = () => Number.NEGATIVE_INFINITY
): BridgeSurfaceProfile[] => bridgeDecks(segments).map(deck => deckProfile(deck, terrainHeight, waterHeight));

/** Deck top at a fraction of the span: flat at the shores, rising to the authored camber. */
export const bridgeDeckHeight = (profile: BridgeSurfaceProfile, along: number) =>
  profile.baseHeight + profile.camber * Math.sin(Math.PI * Math.min(1, Math.max(0, along)));

interface ShoreRamp {
  anchor: RoadPoint;
  deck: number;
  length: number;
  outward: RoadPoint;
  pieces: readonly BridgeApproachPiece[];
}

/** Ramps lengthen as needed so a high deck never exceeds the 1:6 slope on a low bank. */
const shoreRamp = (
  profile: BridgeSurfaceProfile, approach: BridgeApproach, terrainHeight: HeightField
): ShoreRamp => {
  const atStart = approach.anchor === approach.deck.start;
  const deck = bridgeDeckHeight(profile, atStart ? 0 : 1);
  const { anchor, outward } = approach;
  const outer = { x: anchor.x + outward.x * BRIDGE_APPROACH_FLARE, z: anchor.z + outward.z * BRIDGE_APPROACH_FLARE };
  const drop = Math.max(Math.abs(deck - terrainHeight(anchor.x, anchor.z)),
    Math.abs(deck - terrainHeight(outer.x, outer.z)));
  const length = Math.min(MAX_RAMP_LENGTH, Math.max(BRIDGE_APPROACH_FLARE, drop / BRIDGE_MAX_RAMP_SLOPE));
  return { anchor, deck, length, outward, pieces: approach.pieces.filter(piece => piece.startDistance < length) };
};

/** Road distance of a point covered by one shore road piece's flared ribbon, else undefined. */
const pieceDistance = (piece: BridgeApproachPiece, x: number, z: number) => {
  const dx = piece.to.x - piece.from.x, dz = piece.to.z - piece.from.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-12) return undefined;
  const fraction = ((x - piece.from.x) * dx + (z - piece.from.z) * dz) / lengthSquared;
  if (fraction < 0 || fraction > 1) return undefined;
  const distance = piece.startDistance + (piece.endDistance - piece.startDistance) * fraction;
  const lateral = Math.hypot(x - piece.from.x - dx * fraction, z - piece.from.z - dz * fraction);
  return lateral <= bridgeFlareWidth(piece.segment, distance) / 2 ? distance : undefined;
};

/** Without a shore road (removed later), the ramp continues straight along the deck axis. */
const axisDistance = (ramp: ShoreRamp, x: number, z: number) => {
  const dx = x - ramp.anchor.x, dz = z - ramp.anchor.z;
  const along = dx * ramp.outward.x + dz * ramp.outward.z;
  if (along < 0 || along > ramp.length) return undefined;
  const across = Math.abs(dz * ramp.outward.x - dx * ramp.outward.z);
  const fraction = Math.min(1, along / BRIDGE_APPROACH_FLARE);
  const halfWidth = BRIDGE_DECK_HALF_WIDTH + (ROAD_STONE_WIDTH / 2 - BRIDGE_DECK_HALF_WIDTH) * fraction;
  return across <= halfWidth ? along : undefined;
};

/** The deck-wide landing at the anchor, where the round road junction meets the deck end. */
const landingDistance = (ramp: ShoreRamp, x: number, z: number) => {
  const dx = x - ramp.anchor.x, dz = z - ramp.anchor.z;
  if (dx * ramp.outward.x + dz * ramp.outward.z < 0) return undefined;
  const distance = Math.hypot(dx, dz);
  return distance <= BRIDGE_DECK_HALF_WIDTH ? distance : undefined;
};

const rampDistance = (ramp: ShoreRamp, x: number, z: number) => {
  if (!ramp.pieces.length) return axisDistance(ramp, x, z);
  for (const piece of ramp.pieces) {
    const distance = pieceDistance(piece, x, z);
    if (distance !== undefined && distance <= ramp.length) return distance;
  }
  return landingDistance(ramp, x, z);
};

/** Blends from the deck at the anchor to the real ground at the ramp's end, never inverted. */
const rampHeight = (ramp: ShoreRamp, distance: number, x: number, z: number, terrainHeight: HeightField) =>
  ramp.deck + (terrainHeight(x, z) - ramp.deck) * Math.min(1, distance / ramp.length);

/**
 * The one presentation surface shared by roads, actors, carts, picking and the possessed camera.
 * It is intentionally independent from the simulation: actors keep moving in two dimensions.
 * Ramps follow the shore roads that actually meet each anchor, so an angled deck joins a grid road.
 */
export const createBridgeSurfaceHeight = (
  segments: readonly RoadSegment[],
  terrainHeight: HeightField,
  waterHeight: HeightField = () => Number.NEGATIVE_INFINITY
): BridgeHeightLookup => {
  const decks = bridgeDecks(segments);
  if (!decks.length) return () => undefined;
  const profiles = decks.map(deck => deckProfile(deck, terrainHeight, waterHeight));
  const byId = new Map(profiles.map(profile => [profile.id, profile]));
  const ramps = bridgeApproaches(segments, MAX_RAMP_LENGTH)
    .map(approach => shoreRamp(byId.get(approach.deck.id)!, approach, terrainHeight));
  return (x, z) => {
    for (const [index, deck] of decks.entries()) {
      const { across, along } = deckCoordinates(deck, { x, z });
      if (along < 0 || along > deck.length || Math.abs(across) > BRIDGE_DECK_HALF_WIDTH) continue;
      return bridgeDeckHeight(profiles[index]!, along / deck.length);
    }
    for (const ramp of ramps) {
      const distance = rampDistance(ramp, x, z);
      if (distance !== undefined) return rampHeight(ramp, distance, x, z, terrainHeight);
    }
    return undefined;
  };
};

export interface BridgeSurfaceService {
  height: BridgeHeightLookup;
  profiles: () => readonly BridgeSurfaceProfile[];
  /** The road snapshot the surface was built from (bridge art reads the shore ramps from it). */
  segments: () => readonly RoadSegment[];
  /** Rebuilds only when the road snapshot changed (the app replaces the array per road revision). */
  update: (segments: readonly RoadSegment[]) => void;
}

/** Renderer-owned service: one lookup rebuilt per road revision and shared by every consumer. */
export const createBridgeSurfaceService = (
  terrainHeight: HeightField,
  waterHeight: HeightField = () => Number.NEGATIVE_INFINITY
): BridgeSurfaceService => {
  let current: readonly RoadSegment[] | undefined;
  let profiles: readonly BridgeSurfaceProfile[] = [];
  let lookup: BridgeHeightLookup = () => undefined;
  return {
    height: (x, z) => lookup(x, z),
    profiles: () => profiles,
    segments: () => current ?? [],
    update: (segments) => {
      if (segments === current) return;
      current = segments;
      profiles = createBridgeSurfaceProfiles(segments, terrainHeight, waterHeight);
      lookup = createBridgeSurfaceHeight(segments, terrainHeight, waterHeight);
    }
  };
};
