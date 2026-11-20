import { shipHull } from "@shared/catalog";

/** Existing lighter geometry, in tiles (content catalog `boat:lighter`); shared by render recipes and landings. */
const hull = shipHull("boat", "lighter")!;
export const LIGHTER_LENGTH = hull.length;
export const LIGHTER_BEAM = hull.beam;
export const LIGHTER_OAR_LENGTH = hull.oar!.length;
export const LIGHTER_OAR_INBOARD = hull.oar!.inboard;
/** The narrow cargo-only jetty; the turning bay and render deck use this same width. */
export const BOAT_JETTY_DECK_WIDTH = .46;
