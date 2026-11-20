import { LIGHTER_LENGTH } from "../../render-common/ships/lighter-dimensions";
import { DMath } from "../math/deterministic-math";
import type { SettlementPoint } from "./settlement-types";

/** Where a lighter lands beside a pier and the way its carriers walk there from the harbour door. */
export interface LighterLanding { landing: SettlementPoint; route: SettlementPoint[] }
/** A pier: from its foot on the shore to the end of its fixed deck's gangway (the ship's hull side). */
interface PierLine { point: SettlementPoint; shore: SettlementPoint }

/** Tiles along the pier from its foot to the first landing place. */
const LANDING_ALONG = .9;
/** Tiles between landing places along the deck: a barge's length (2.5) and a little room. */
const LANDING_SPACING = 2.8;
/** Half a barge's length: a place on the deck keeps its barge this far inside the deck's end, plus the margin. */
const BARGE_HALF_LENGTH = LIGHTER_LENGTH / 2;
/** A barge lying beside the deck stays this far short of the gangway gap, clear of a docking ship's hull. */
const DECK_END_MARGIN = .5;
/** Tiles out from the pier's side where a lighter lies, and where its carriers stand (on the shore or deck). */
const LANDING_OUT = 1.1;
const STEP_OUT = .5;
const DECK_STEP_OUT = .2;

/**
 * Landing places beside a pier (owner, 2026-10-20, NAV-03): on both sides, one beside its foot (worked from the
 * shore) and more along its fixed deck wherever a whole barge fits beside it short of the deck's end (worked
 * from the deck's edge). `deckLength` is the fixed deck (the pier without its gangway); `water` filters places
 * whose barge would lie on land. `porterRoute` leads from the harbour door to the pier's foot.
 */
export const pierLandingPlaces = (
  pier: PierLine, deckLength: number, porterRoute: readonly SettlementPoint[],
  water: (point: SettlementPoint) => boolean
): LighterLanding[] => {
  const { point, shore } = pier, length = DMath.hypot(point.x - shore.x, point.z - shore.z) || 1;
  const along = { x: (point.x - shore.x) / length, z: (point.z - shore.z) / length };
  const last = deckLength - BARGE_HALF_LENGTH - DECK_END_MARGIN, places: LighterLanding[] = [];
  for (const side of [1, -1]) {
    const out = { x: along.z * side, z: -along.x * side };
    const at = (distance: number, sideways: number) =>
      ({ x: shore.x + along.x * distance + out.x * sideways, z: shore.z + along.z * distance + out.z * sideways });
    for (let distance = LANDING_ALONG, place = 0; place === 0 || distance <= last;
      distance += LANDING_SPACING, place++) {
      const landing = at(distance, LANDING_OUT);
      if (!water(landing)) continue;
      const route = place === 0 ? [...porterRoute, at(0, STEP_OUT)]
        : [...porterRoute, shore, at(distance, DECK_STEP_OUT)];
      places.push({ landing, route });
    }
  }
  return places;
};
