import { indigenousRoofHeight } from "./indigenous-roof-profile";

/** Actual piecewise barrel membrane, matching the renderer's12/4 across-roof segments.
 * Analytic height overestimates a coarse curved roof severely near the bearing edges.
 */
export const indigenousBarrelFacetHeight = (x: number, detailed: boolean) => {
  const count = detailed ? 12 : 4, clamped = Math.max(-.5, Math.min(.5, x));
  const index = Math.min(count - 1, Math.floor((clamped + .5) * count));
  const left = index / count - .5, right = (index + 1) / count - .5;
  const share = (clamped - left) / (right - left);
  return indigenousRoofHeight("barrel", left, 0) * (1 - share)
    + indigenousRoofHeight("barrel", right, 0) * share;
};

/** Lowest opaque facet over the complete post/beam footprint, not only its centreline. */
export const indigenousBarrelBearingHeight = (x: number, halfFootprint: number, detailed: boolean) =>
  Math.min(indigenousBarrelFacetHeight(x - halfFootprint, detailed),
    indigenousBarrelFacetHeight(x + halfFootprint, detailed));
