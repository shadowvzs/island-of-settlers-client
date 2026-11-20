import { BRIDGE_DECK_WIDTH, ROAD_STONE_WIDTH, roadRibbonWidth,
  type RoadSegment } from "../../shared/settlement/road-types";
import { TWO_LANE_CART_HALF_WIDTH } from "../logistics/handcart-rules";

export type RoadVergeBand = "A" | "B" | "C";

/** Verge bands as distances from the centreline of a stone road (world units) and plant densities. */
export const ROAD_VERGE_BANDS: Readonly<Record<RoadVergeBand, { density: number; from: number; to: number }>> = {
  /** Owner O11: the verge starts where two passing carts end (`TWO_LANE_CART_HALF_WIDTH`, 0.81). */
  A: { density: .9, from: TWO_LANE_CART_HALF_WIDTH, to: .95 },
  B: { density: .8, from: .95, to: 1.15 },
  C: { density: .5, from: 1.15, to: 1.45 }
};

/**
 * Field cover (meadow grass tufts) beside a verge road: thinned and lowered up to the end of band
 * B, recovering through band C to the full meadow at this distance, so the verge plants read.
 */
export const VERGE_COVER_LOW_UNTIL = ROAD_VERGE_BANDS.B.to;
export const VERGE_COVER_FULL_FROM = 1.9;

/** Least meadow / forest floor ground weight (`coverGroundWeight`) a verge plant grows on. */
export const VERGE_MIN_COVER_GROUND = .5;

/**
 * Player-planted completed ordinary roads only: an unplanted road, a bridge, a door lane and a
 * placement preview never grow a verge. The saved `verge` field alone unlocks the plants and the
 * meadow thinning beside the stretch.
 */
export const growsRoadVerge = (segment: RoadSegment) =>
  segment.verge !== undefined && !segment.preview && !segment.doorway && !segment.bridge;

/**
 * How far a road's drawn ribbon reaches beyond a stone road's at `fraction` (bridge decks and the
 * flared shore roads at bridge ends): verge bands shift outward by it, so plants stay off the flare.
 */
export const roadVergeWidening = (segment: RoadSegment, fraction: number) =>
  Math.max(0, roadRibbonWidth(segment, fraction) / 2 - ROAD_STONE_WIDTH / 2);

/** The widest widening of any road: a bridge deck, or a shore road flared to the deck width. */
export const ROAD_VERGE_MAX_WIDENING = BRIDGE_DECK_WIDTH / 2 - ROAD_STONE_WIDTH / 2;

/** The widest widening anywhere along a segment (its ribbon is linear between the two ends). */
export const roadVergeMaxWidening = (segment: RoadSegment) =>
  Math.max(roadVergeWidening(segment, 0), roadVergeWidening(segment, 1));
