import { shipHull } from "@shared/catalog";

/**
 * The Fishery's one-man skiff (FISHER-BOAT plan §5.2 R1), in tiles: shared by the launch-site
 * finder, the trip timeline and every nation's render recipe, so gameplay and art agree
 * (content catalog `boat:fishingSkiff`).
 */
const hull = shipHull("boat", "fishingSkiff")!;
export const FISHING_SKIFF_LENGTH = hull.length;
export const FISHING_SKIFF_BEAM = hull.beam;
/** Rendered hull keel below its waterline origin, in world units. */
export const FISHING_SKIFF_KEEL_DEPTH = .1 * .78;
export const FISHING_SKIFF_OAR_LENGTH = hull.oar!.length;
export const FISHING_SKIFF_OAR_INBOARD = hull.oar!.inboard;
/** Hull half-beam plus the outboard oar: the water a rowing skiff sweeps on either side. */
export const FISHING_SKIFF_ROW_CLEARANCE =
  FISHING_SKIFF_BEAM / 2 + FISHING_SKIFF_OAR_LENGTH - FISHING_SKIFF_OAR_INBOARD;
