/** Buildings switch to their High recipe (windows, ornaments) from this camera zoom on High quality. */
const BUILDING_DETAIL_ZOOM = 1.5;

/**
 * R16b: a building already drawn Detailed keeps that recipe until the eye is this much farther than
 * the radius, so walking along the edge never flips a building back and forth.
 */
export const BUILDING_EYE_DETAIL_HYSTERESIS = 10;

export const isBuildingDetailed = (high: boolean, zoom: number) => high && zoom >= BUILDING_DETAIL_ZOOM;

/** The possessed eye (world units) and the quality preset's Detailed radius around it. */
export type BuildingDetailEye = { radius: number; x: number; y: number; z: number };

type Point = { x: number; y: number; z: number };

/**
 * R16b: the recipe one building should draw. In the possessed view (`eye`) the strategic zoom no
 * longer matters: Detailed within the eye radius, simple beyond, with hysteresis on the drawn recipe.
 */
export const isBuildingDetailedInView = (
  high: boolean, zoom: number, eye: BuildingDetailEye | undefined, at: Point, shownDetailed: boolean
) => {
  if (!high) return false;
  if (!eye) return isBuildingDetailed(high, zoom);
  const reach = shownDetailed ? eye.radius + BUILDING_EYE_DETAIL_HYSTERESIS : eye.radius;
  const dx = at.x - eye.x, dy = at.y - eye.y, dz = at.z - eye.z;
  return dx * dx + dy * dy + dz * dz <= reach * reach;
};
