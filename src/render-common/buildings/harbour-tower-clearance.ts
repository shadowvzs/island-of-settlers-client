import type { BuildingPart } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";

/** The harbour's shore lantern: its authored position is the gameplay beacon anchor. */
export const HARBOUR_TOWER_POSITION = [-1.04, 2.39, -.18] as const;
/**
 * The hall roof is cut back inside the beacon's stone face where the two meet. The opening is
 * smaller than the tower body, so the roof's cut edge stays hidden behind the masonry instead of
 * slicing through the visible tower; its windows and silhouette remain untouched.
 */
export const HARBOUR_TOWER_ROOF_OPENING = { radius: .36, x: HARBOUR_TOWER_POSITION[0],
  z: HARBOUR_TOWER_POSITION[2] } as const;
/** Authored roof heights the beacon rises through (about 1.4-2.0 on the tall harbour roof). */
const ROOF_BAND = { bottom: 1, top: 2.2 } as const;

const isRoofPart = (part: BuildingPart) => part.surface.startsWith("roof") ||
  part.roofLayer !== undefined || part.roofProfile !== undefined;

/**
 * Marks the harbour hall roof pieces that cross the beacon. The renderer removes the marked
 * triangles inside the tower body; a mere cover collar would hide the tower's lower look-out
 * window, so the roof itself is opened and the tower stays fully readable.
 */
export const withHarbourTowerRoofOpenings = (parts: readonly BuildingPart[]): BuildingPart[] => parts.map(part => {
  if (part.stock || part.roofOpening || !isRoofPart(part)) return part;
  const { max, min } = getRomanPartBounds(part);
  if (max[1] <= ROOF_BAND.bottom || min[1] >= ROOF_BAND.top) return part;
  return { ...part, roofOpening: { ...HARBOUR_TOWER_ROOF_OPENING } };
});
