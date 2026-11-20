import { DMath } from "../math/deterministic-math";
import { distanceToSegment } from "./settlement-geometry";
import type { ShipWorkpoint } from "./settlement-ship-workpoint";
import type { SettlementPoint } from "./settlement-types";

/** Shared simulation/render geometry: the remaining gap is bridged only while a ship is docked. */
export const HARBOUR_GANGWAY_LENGTH = 1;
export const HARBOUR_PIER_DECK_WIDTH = .68;
/** Existing nearest-berth land-search radius and ordinary connected shore-access radius. */
export const HARBOUR_LOCAL_SHORE_REACH = 12;
export const HARBOUR_WIDE_SHORE_REACH = SAILING_SHIP_OVERALL_LENGTH * 2 + SAILING_SHIP_SPACING;
const SHORTEST_DECK = .2;

export const harbourFixedPierEnd = (work: ShipWorkpoint) => {
  const length = DMath.hypot(work.point.x - work.shore.x, work.y - work.shoreY, work.point.z - work.shore.z);
  const fraction = length - HARBOUR_GANGWAY_LENGTH >= SHORTEST_DECK ?
    (length - HARBOUR_GANGWAY_LENGTH) / length : 0;
  return { x: work.shore.x + (work.point.x - work.shore.x) * fraction,
    y: work.shoreY + (work.y - work.shoreY) * fraction,
    z: work.shore.z + (work.point.z - work.shore.z) * fraction };
};

const cross = (a: SettlementPoint, b: SettlementPoint, c: SettlementPoint) =>
  (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);

/** Clear water between the actual fixed deck edges, not between the ships' berth centres. */
export const harbourPierClearGap = (first: ShipWorkpoint, second: ShipWorkpoint) => {
  const a = first.shore, b = harbourFixedPierEnd(first), c = second.shore, d = harbourFixedPierEnd(second);
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0;
  return Math.max(0, Math.min(distanceToSegment(a, c, d), distanceToSegment(b, c, d),
    distanceToSegment(c, a, b), distanceToSegment(d, a, b)) - HARBOUR_PIER_DECK_WIDTH);
};
import { SAILING_SHIP_OVERALL_LENGTH, SAILING_SHIP_SPACING } from "../../render-common/ships/ship-dimensions";
