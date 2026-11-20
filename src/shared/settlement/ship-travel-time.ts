import { SHIP_SAILING_MULTIPLIER } from "../balance/colonies";
import { reducedDuration } from "../progression/talents";

/**
 * Seconds a ship sails a route beyond the map edge; `reduction` is the voyage's talent share (Shipping,
 * or adventure sailing), the same the fleet's timer rate uses (settlement-naval-fleet `shipVoyageRate`).
 */
export const shipTravelSeconds = (routeSeconds: number, reduction = 0) =>
  reducedDuration(routeSeconds, reduction) / SHIP_SAILING_MULTIPLIER;
