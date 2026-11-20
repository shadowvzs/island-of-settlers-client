import { shipHull } from "@shared/catalog";

import { DMath } from "../../shared/math/deterministic-math";

/** The sailing ship's hull contract (content catalog `ship:sailingShip`). */
const hull = shipHull("ship", "sailingShip")!;
/** Shared rendered sailing-ship scale and conservative overall footprint, in world units. */
export const SAILING_SHIP_SCALE = hull.scale!;
export const SAILING_SHIP_HULL_LENGTH = hull.length;
export const SAILING_SHIP_HULL_BEAM = hull.beam;
export const SAILING_SHIP_OVERALL_LENGTH = hull.overallLength!;
export const SAILING_SHIP_OVERALL_BEAM = hull.overallBeam!;
export const SAILING_SHIP_TURN_RADIUS = DMath.hypot(
  SAILING_SHIP_OVERALL_LENGTH / 2, SAILING_SHIP_OVERALL_BEAM / 2);
export const SAILING_SHIP_SPACING = hull.spacing!;
