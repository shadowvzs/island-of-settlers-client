import type { GridSize } from "../grid-geometry";
import { smoothstep } from "../noise";
import { boxBlurVertices } from "./box-blur";

/**
 * Summit uplift (MC-04): the upper massif rises; the foothills, mine aprons, plateaus and building
 * land below SUMMIT_FROM keep their heights. The uplift follows the massif's smoothed form (its
 * support) more than the local height, so the whole upper massif rises as one solid mass: bowls and
 * cirques rise with their rims instead of deepening into arenas, and crests do not grow into
 * needles. Applied to the designed relief before the valley carving, so the stream-power valleys
 * cut into the taller relief; the talus limit stays steeper in the same zone
 * (`createSummitTalusScale`), otherwise the relaxation would melt the new faces.
 */
const SUMMIT_FROM = 5.5;
const SUMMIT_TO = 9;
/** Mountain mask (0..1) over which the zone fades in: only real massifs, never lowland hills. */
const MASSIF_MASK: [number, number] = [0.3, 0.7];
/** Extra rise per unit of support above SUMMIT_FROM at full strength: crests grow to about 18-20. */
const UPLIFT_GAIN = 2.2;
/** Talus limit multiplier inside the full zone (1.3 -> about 2.5 rise per cell, near 68 degrees). */
const SUMMIT_TALUS = 0.9;
/** The massif's smoothed form: two box passes of this radius (sigma about 5 cells). */
const SUPPORT_BLUR = { passes: 2, radius: 4 } as const;
/** Share of the uplift that follows the smoothed form (the rest follows the local height). */
const SUPPORT_SHARE = 0.85;
/** Ground below this band never rises, however high the massif beside it (aprons, foothills). */
const LOW_GUARD: [number, number] = [SUMMIT_FROM - 1, SUMMIT_FROM + 1];
/**
 * Share of a hollow (ground below the smoothed form) that fills up in the full summit zone: the
 * uplifted massif is a solid rock mass; the valley carving cuts its valleys afterwards.
 */
const HOLLOW_FILL = 0.65;
/**
 * The massif's foot zone (above this band, inside a strong mountain mask) fills its hollows by this
 * share too: valley heads and scree bowls at the foot rise toward the massif's form instead of
 * reading as pits in front of it.
 */
const FOOT_FILL = 0.6;
const FOOT_BAND: [number, number] = [0.9, 2.6];

/** The massif's smoothed form per vertex (blurred heights). */
export const createSummitSupport = (grid: GridSize, heights: Float32Array) => {
  const support = Float32Array.from(heights);
  boxBlurVertices(grid, support, SUPPORT_BLUR);
  return support;
};

/** Height the uplift of a vertex is measured from: mostly the smoothed form, partly its own height. */
const getUpliftBase = (height: number, support: number) => support + (height - support) * (1 - SUPPORT_SHARE);

/** 0..1 per vertex: the upper massif (its base above SUMMIT_FROM, inside a strong mountain mask). */
export const createSummitMask = (heights: Float32Array, support: Float32Array, mountainMask: Float32Array) => {
  const mask = new Float32Array(heights.length);
  for (let index = 0; index < heights.length; index += 1) {
    const massif = smoothstep(MASSIF_MASK[0], MASSIF_MASK[1], mountainMask[index]!);
    const base = getUpliftBase(heights[index]!, support[index]!);
    mask[index] = smoothstep(SUMMIT_FROM, SUMMIT_TO, base) * massif *
      smoothstep(LOW_GUARD[0], LOW_GUARD[1], heights[index]!);
  }
  return mask;
};

/** Raises the upper massif in place (`amount` 0..1, the generator option). */
export const applySummitUplift = (heights: Float32Array, support: Float32Array, mask: Float32Array, amount: number) => {
  const gain = amount * UPLIFT_GAIN;
  for (let index = 0; index < heights.length; index += 1) {
    if (mask[index]! <= 0) continue;
    const above = getUpliftBase(heights[index]!, support[index]!) - SUMMIT_FROM;
    if (above > 0) heights[index] = heights[index]! + above * mask[index]! * gain;
  }
};

/** Fills the hollows of the uplifted summit zone (bowls, cirques, pits) toward its smoothed form. */
export const fillSummitHollows = (grid: GridSize, heights: Float32Array, mask: Float32Array,
  mountainMask: Float32Array, amount: number) => {
  const support = createSummitSupport(grid, heights);
  for (let index = 0; index < heights.length; index += 1) {
    const hollow = support[index]! - heights[index]!;
    if (hollow <= 0) continue;
    const foot = smoothstep(MASSIF_MASK[0], MASSIF_MASK[1], mountainMask[index]!) *
      smoothstep(FOOT_BAND[0], FOOT_BAND[1], heights[index]!) * FOOT_FILL;
    const share = Math.max(mask[index]! * HOLLOW_FILL, foot) * amount;
    if (share > 0) heights[index] = heights[index]! + hollow * share;
  }
};

/** Per vertex talus limit multiplier (>= 1) for limitSlopes: steeper faces inside the summit zone. */
export const createSummitTalusScale = (mask: Float32Array, amount: number) =>
  mask.map(value => 1 + value * amount * SUMMIT_TALUS);

/**
 * Uplifts the summits of the designed relief and returns the talus scale of the zone, or undefined
 * when the option is off (then every later step behaves exactly as before).
 */
export const upliftSummits = (grid: GridSize, heights: Float32Array, mountainMask: Float32Array,
  amount: number | undefined) => {
  if (!amount || amount <= 0) return undefined;
  const support = createSummitSupport(grid, heights);
  const mask = createSummitMask(heights, support, mountainMask);
  applySummitUplift(heights, support, mask, amount);
  fillSummitHollows(grid, heights, mask, mountainMask, amount);
  return createSummitTalusScale(mask, amount);
};
