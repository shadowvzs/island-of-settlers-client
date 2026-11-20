import { VIKING_SHINGLE_ROWS_PER_TILE } from "../../../render-common/buildings/nation-roof-shingles";
import { fract, smoothstep } from "../../../shared/world/noise";
import { periodicNoise } from "./roman-texture-grain";
import {
  blockVariation, type RomanSurfaceDetail, seamDistance, type SurfaceCoordinate,
wrapIndex} from "./surface-detail-common";

const SHINGLES_PER_ROW = 6;
/** How far up the row the rounded butt of a shingle is cut back at its corners, in rows. */
const BUTT_ROUNDING = .2;
/** Kawara pitches per texture tile, matching the cover-tile rolls (see nation-roof-geometry). */
export const KAWARA_PITCHES_PER_TILE = 4;

/**
 * Split-wood shingles in staggered rows: each row ends in rounded butts at the course edge (on High
 * the stepped course itself), with dark notches between them, open seams, grain, weathered tone and
 * a little lichen.
 */
export const vikingShingleDetail = ({ grain, mineral, u, v, weather }: SurfaceCoordinate): RomanSurfaceDetail => {
  // Canvas rows are flipped on upload: texture v grows down the slope, so canvas v grows up it.
  const rowCoordinate = (1 - v) * VIKING_SHINGLE_ROWS_PER_TILE + .5;
  const row = wrapIndex(Math.floor(rowCoordinate), VIKING_SHINGLE_ROWS_PER_TILE), down = fract(rowCoordinate);
  const shifted = u * SHINGLES_PER_ROW + (row % 2) * .5 + (blockVariation(row, 9) - .5) * .2;
  const across = fract(shifted), id = wrapIndex(Math.floor(shifted), SHINGLES_PER_ROW) + row * 11;
  const butt = 1 - BUTT_ROUNDING + BUTT_ROUNDING * Math.sqrt(Math.max(0, 1 - (across * 2 - 1) ** 2));
  const solid = smoothstep(.012, .05, seamDistance(shifted)) * smoothstep(0, .03, butt - down);
  const tone = blockVariation(id, 2) - .5;
  const fibres = Math.sin((across * 9 + Math.sin(down * 5 + id) * .4) * Math.PI * 2);
  const split = Math.pow(Math.max(0, Math.sin((across * 3.3 + id * .37) * Math.PI * 2)), 40) * smoothstep(.3, 1, down);
  const lichen = smoothstep(.72, .8, periodicNoise(u, v, 16) * .6 + mineral * .4) * .5;
  const wood = .8 + tone * .18 + fibres * .05 + weather * .14 + down * .06 - split * .2 + (grain - .5) * .04;
  return {
    brightness: .42 + solid * (wood - .42),
    colour: [1 - lichen * .1 + tone * .03, 1 + lichen * .04, 1 - lichen * .14 - tone * .03],
    height: .1 + solid * (.45 + down * .15 + fibres * .03 - split * .12) + (mineral - .5) * .015,
    roughness: 226 + weather * 22 + lichen * 6
  };
};

/** Pan-tile profile across one pitch: 0 in the pan's trough, 1 under a roll. */
const panProfile = (value: number) => .5 - .5 * Math.cos(fract(value) * Math.PI * 2);

/** Courses (tile laps) per roll pitch: kawara are about half as long as a pitch is wide. */
const KAWARA_COURSES_PER_PITCH = 3;

/**
 * Hongawara in roll pitches: concave pans between the rolls (v, along the eave) and narrow lap
 * shadows where each course overlaps the next (u, down the slope). The roof maps every face, hip
 * ends included, this way round (see japaneseRoofUv in nation-roof-geometry.ts).
 */
export const kawaraDetail = ({ grain, mineral, u, v, weather }: SurfaceCoordinate): RomanSurfaceDetail => {
  const course = u * KAWARA_PITCHES_PER_TILE * KAWARA_COURSES_PER_PITCH, pitch = v * KAWARA_PITCHES_PER_TILE;
  const pan = panProfile(pitch);
  const lap = Math.exp(-seamDistance(course) * 40);
  const tone = blockVariation(wrapIndex(Math.floor(course), 12), wrapIndex(Math.floor(pitch + .5), 4)) - .5;
  const bulge = Math.sin(fract(course) * Math.PI);
  const glaze = (mineral - .5) * .06 + (grain - .5) * .03;
  return {
    brightness: .62 + pan * .3 + bulge * .06 + tone * .12 + weather * .12 + glaze - lap * .25,
    colour: [1 + tone * .02, 1, 1 - tone * .03],
    // Broad pans need tall heights to tilt the per-texel normal map.
    height: pan * 8 - lap * 1.2 + bulge * 1.2 + glaze * .3,
    roughness: 200 + weather * 35 + mineral * 20
  };
};

/** Sun-baked earthen render on terraces and domes: trowel sweeps, shrinkage cracks, sand grit. */
export const earthenRoofDetail = ({ grain, mineral, u, v, weather }: SurfaceCoordinate): RomanSurfaceDetail => {
  const sweep = Math.sin((u * 2 + v * 3 + periodicNoise(u, v, 4) * 2.4) * Math.PI * 6) * .06;
  const crackField = periodicNoise(u, v, 16) * .65 + periodicNoise(u, v, 64) * .35;
  const crack = Math.exp(-(((crackField - .5) / .005) ** 2)) * smoothstep(.45, .7, periodicNoise(u + .2, v + .6, 4));
  const grit = grain > .95 ? .05 : 0;
  return {
    brightness: .88 + weather * .16 + sweep * .3 + (mineral - .5) * .08 + (grain - .5) * .05 - crack * .22 + grit,
    colour: [1.02, 1, .95 + (weather - .5) * .05],
    height: .5 + sweep + (grain - .5) * .06 + (mineral - .5) * .04 - crack * .25,
    roughness: 238 + weather * 14
  };
};
