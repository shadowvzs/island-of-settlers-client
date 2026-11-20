import { fract, smoothstep } from "../../../shared/world/noise";
import {
  blockVariation, type RomanSurfaceDetail, type SurfaceCoordinate, wrapIndex
} from "./surface-detail-common";

/**
 * Raw animal hide. The left half of the tile is the scraped flesh side: soft blotches, fine
 * branching vein marks and a fibrous membrane. The right half is the hair side: short fur
 * tufts combed down and away from the spine, each with its own length and twist.
 */
const fleshSide = ({ grain, mineral, u, v, weather }: SurfaceCoordinate): RomanSurfaceDetail => {
  const warp = Math.sin(v * 13 + Math.sin(u * 7) * 2) * .6 + Math.sin(u * 23 + v * 5) * .25;
  const blotch = Math.sin(u * 17 + warp * 2.1) * Math.sin(v * 12 + warp * 1.7 + 1.1);
  const stain = smoothstep(.35, .9, Math.sin(u * 8.5 + v * 5 + warp) * Math.sin(v * 6.5 - u * 3 + 2) + .25);
  // Sparse, irregular vein marks: thin dark threads that wander and fade, not regular contours.
  const thread = 1 - Math.abs(Math.sin(u * 29 + warp * 3.4 + Math.sin(v * 47) * .5));
  const vein = Math.pow(thread, 40) * smoothstep(.2, .7, Math.sin(v * 9 + u * 17 + 2.5) * .5 + .5);
  const scrape = Math.sin(v * 160 + warp * 6 + u * 24) * (grain - .3);
  return {
    brightness: .9 + blotch * .06 + weather * .07 + (grain - .5) * .1 - vein * .12 - stain * .08 + scrape * .03,
    colour: [1 + stain * .02 + vein * .04, 1 - stain * .05 - vein * .03, 1 - stain * .13 - (mineral - .5) * .06],
    height: .5 + scrape * .03 - vein * .03 + (grain - .5) * .03 + (mineral - .5) * .015,
    roughness: 170 + weather * 45 - stain * 20
  };
};

/** Strand cells per tile side: one short hair tuft per cell, about 6 texels on the High map. */
const HAIR_CELLS = 160;
/** The hair side's u range (see roman-stretched-hide.ts): the spine runs down its middle. */
const HAIR_SPINE_U = .75;
const HAIR_U_PER_HIDE = .46;

interface HairStrand { along: number; coverage: number }

/**
 * The strand of one cell nearest to (cellU, cellV): jittered centre, random length and width, combed
 * down and away from the spine with a random twist, so neighbouring tufts never line up into stripes.
 */
const cellStrand = (column: number, row: number, cellU: number, cellV: number, side: number): HairStrand => {
  const seed = blockVariation(wrapIndex(column, HAIR_CELLS), wrapIndex(row, HAIR_CELLS));
  const twist = blockVariation(wrapIndex(row, HAIR_CELLS) + 313, wrapIndex(column, HAIR_CELLS) + 71);
  const angle = side * 1.1 + (twist - .5) * .8;
  const directionU = Math.sin(angle), directionV = Math.cos(angle);
  const offsetU = cellU - column - fract(seed * 7.13), offsetV = cellV - row - fract(seed * 3.71);
  const half = .4 + fract(seed * 11.7) * .5;
  const along = Math.max(-half, Math.min(half, offsetU * directionU + offsetV * directionV));
  const distance = Math.hypot(offsetU - along * directionU, offsetV - along * directionV);
  const width = .14 + twist * .12;
  return { along: (along + half) / (2 * half), coverage: smoothstep(width, 0, distance) };
};

/** The most visible strand over this texel among its own and the eight neighbouring cells. */
const hairStrand = (u: number, v: number): HairStrand => {
  const cellU = u * HAIR_CELLS, cellV = v * HAIR_CELLS;
  const column = Math.floor(cellU), row = Math.floor(cellV);
  const side = Math.max(-1, Math.min(1, (u - HAIR_SPINE_U) / HAIR_U_PER_HIDE * 2));
  let best: HairStrand = { along: 0, coverage: 0 };
  for (let columnStep = -1; columnStep <= 1; columnStep++)
    for (let rowStep = -1; rowStep <= 1; rowStep++) {
      const strand = cellStrand(column + columnStep, row + rowStep, cellU, cellV, side);
      if (strand.coverage > best.coverage) best = strand;
    }
  return best;
};

/** Hair side: short irregular strands over a darker undercoat, lighter at the tips, in soft clumps. */
const hairSide = ({ grain, mineral, u, v, weather }: SurfaceCoordinate): RomanSurfaceDetail => {
  const { along, coverage } = hairStrand(u, v);
  const clump = Math.sin(u * 31 + Math.sin(v * 17) * 1.6) * Math.sin(v * 23 + Math.sin(u * 13) * 1.4);
  return {
    brightness: .68 + coverage * (.2 + along * .12) + clump * .05 + (grain - .5) * .12 + weather * .05,
    colour: [1 + (mineral - .5) * .08 + coverage * .02, 1, 1 - (mineral - .5) * .1 - coverage * .03],
    height: .5 + coverage * .07 + clump * .015,
    roughness: 236 + grain * 19 - coverage * 12
  };
};

export const hideSurfaceDetail = (point: SurfaceCoordinate): RomanSurfaceDetail =>
  point.u < .5 ? fleshSide(point) : hairSide(point);
