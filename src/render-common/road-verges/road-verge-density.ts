/**
 * Verge thinning and detail by projected screen size (owner O5): a chunk's nearest plant height in
 * pixels decides how much of its rank-ordered subset is drawn. Projected size already contains the
 * spyglass zoom (a narrower field of view), so the effective distance is eye distance / zoom in the
 * isometric view, the possessed eye view and the spyglass alike. Shared by High and Minimal.
 */

/** Height (world units) of the reference verge plant whose projected size is measured. */
export const VERGE_REFERENCE_HEIGHT = .2;

/** Kept fraction of each chunk's rank-ordered plants per level: hidden, quarter, half, all. */
export const VERGE_KEEP_LEVELS = [0, .25, .5, 1] as const;
export type VergeKeepLevel = 0 | 1 | 2 | 3;

/** Minimum projected pixels of the reference plant for levels 1, 2 and 3. */
const LEVEL_PIXELS = [1.6, 3, 5.5] as const;
/** High draws the authored High parts from this projected size on. */
const NEAR_PIXELS = 18;
/** A level or tier is left only when the size falls this much below its entry threshold. */
const HYSTERESIS = .82;

/** Projected pixel height of `height` world units at view-space depth `depth`. */
export const vergeProjectedPixels = (height: number, depth: number, projectionScale: number,
  viewportHeight: number, orthographic: boolean) => {
  const pixels = height * projectionScale * viewportHeight * .5;
  return orthographic ? pixels : pixels / Math.max(.05, depth);
};

/** Nested level: a smaller projected size only ever drops plants of the larger one, never adds any. */
export const roadVergeKeepLevel = (pixels: number, previous: VergeKeepLevel = 0): VergeKeepLevel => {
  let level: VergeKeepLevel = 0;
  for (let index = 0; index < LEVEL_PIXELS.length; index += 1) {
    const kept = index + 1 <= previous;
    if (pixels >= LEVEL_PIXELS[index]! * (kept ? HYSTERESIS : 1)) level = (index + 1) as VergeKeepLevel;
  }
  return level;
};

/** High parts close up (with hysteresis); Minimal never asks. */
export const roadVergeNear = (pixels: number, wasNear = false) =>
  pixels >= NEAR_PIXELS * (wasNear ? HYSTERESIS : 1);
