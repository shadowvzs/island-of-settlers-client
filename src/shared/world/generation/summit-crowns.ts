import type { GridSize } from "../grid-geometry";
import { smoothstep } from "../noise";

/** Height band over which the rounding fades in (the snow line starts at 7). */
const CROWN_BAND: [number, number] = [6, 9];
/** Mountain mask band: only real massifs. */
const CROWN_MASSIF: [number, number] = [0.3, 0.7];
/** Share of a vertex's sharp excess removed per pass. */
const CROWN_SHARE = 0.5;
/**
 * Excess over the neighbour mean a crown keeps (its curvature): a broad rounded summit is left as
 * it is, only the sharper tip of a needle or a knife edge sinks.
 */
const CROWN_CURVATURE = 0.35;
const CROWN_PASSES = 4;

/** Mean of the 8 neighbours (diagonals at half weight: about their distance's share). */
const neighbourMean = (source: Float32Array, index: number, stride: number) => {
  const axial = source[index - 1]! + source[index + 1]! + source[index - stride]! + source[index + stride]!;
  const diagonal = source[index - stride - 1]! + source[index - stride + 1]! + source[index + stride - 1]! +
    source[index + stride + 1]!;
  return (axial + diagonal * 0.5) / 6;
};

/** Rounding weight 0..1 of a vertex: upper massif only. */
const crownWeight = (height: number, mountain: number) =>
  smoothstep(CROWN_BAND[0], CROWN_BAND[1], height) * smoothstep(CROWN_MASSIF[0], CROWN_MASSIF[1], mountain);

/**
 * WALL-PATCHES (owner review 2026-11-09, "the peak looks like a horn"): the talus limit lets a summit
 * stand as a one-vertex needle or a knife crest, which reads as a horn with a tiny snow tip. Convex
 * vertices of the upper massif sink part of the way toward the mean of their neighbours, a few
 * passes: needles and knife edges become rounded rock crowns, while faces (planar) and gullies,
 * saddles and valleys (concave) keep their heights. Lowland and foothills are untouched.
 *
 * Rounds in place; deterministic, CPU only.
 */
export const roundSummitCrowns = (grid: GridSize, heights: Float32Array, mountainMask: Float32Array) => {
  const stride = grid.cellsX + 1;
  const source = new Float32Array(heights.length);
  for (let pass = 0; pass < CROWN_PASSES; pass += 1) {
    source.set(heights);
    for (let z = 1; z < grid.cellsZ; z += 1) {
      for (let x = 1; x < grid.cellsX; x += 1) {
        const index = z * stride + x;
        const height = source[index]!;
        if (height < CROWN_BAND[0]) continue;
        const excess = height - neighbourMean(source, index, stride) - CROWN_CURVATURE;
        if (excess <= 0) continue;
        heights[index] = height - excess * CROWN_SHARE * crownWeight(height, mountainMask[index]!);
      }
    }
  }
};
