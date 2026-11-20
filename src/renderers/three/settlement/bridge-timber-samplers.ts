import type { BridgeTimberFinish } from "../../../render-common/bridges/bridge-level-finish";
import { smoothstep } from "../../../shared/world/noise";
import { periodicNoise } from "../buildings/roman-texture-grain";
import {
  blockVariation, type RomanSurfaceDetail, seamDistance, type SurfaceCoordinate, type SurfaceSampler, wrapIndex
} from "../buildings/surface-detail-common";

/**
 * Timbers of the wooden bridge levels (original procedural grain, not photographs). Softwood paints
 * only the level-1 pole deck of Minimal; its beams keep the shared building timber.
 */
export type BridgeTierTimber = BridgeTimberFinish;

/** Base albedo of each tier: vivid enough to read at gameplay distance, darkened by the grain. */
export const BRIDGE_TIMBER_BASE: Readonly<Record<BridgeTierTimber, readonly [number, number, number]>> = {
  cedar: [214, 118, 70],
  softwood: [184, 136, 88],
  hardwood: [206, 164, 108],
  mahogany: [176, 70, 46],
  walnut: [124, 84, 60]
};

const BOARDS_PER_TILE = 4;
const POLES_PER_TILE = 8;

/** Oak-like hardwood: tight straight fibres with pale ray flecks across the grain. */
const hardwoodGrain = ({ grain, mineral, u, v, weather }: SurfaceCoordinate): RomanSurfaceDetail => {
  const warp = periodicNoise(u, v, 6) * .5 + Math.sin(v * Math.PI * 2) * .15;
  const fibre = Math.sin((u * 46 + warp) * Math.PI * 2) * .04;
  const fleck = Math.max(0, periodicNoise(u, v, 32) - .74) * 2.4;
  return { brightness: .86 + fibre + fleck * .25 + (mineral - .5) * .05 + (weather - .5) * .05,
    colour: [1, 1, .97], height: .5 + fibre * 1.2 + fleck * .2 + (grain - .5) * .02, roughness: 196 + weather * 24 };
};

/** Cedar: fine planed fibres and pale sapwood streaks along the length. */
const cedarGrain = ({ grain, mineral, u, v, weather }: SurfaceCoordinate): RomanSurfaceDetail => {
  const curve = Math.sin(v * Math.PI * 2) * .25;
  const fibre = Math.sin((u * 64 + curve) * Math.PI * 2) * .03 + Math.sin((u * 150 + curve) * Math.PI * 2) * .012;
  const sapwood = smoothstep(.58, .72, periodicNoise(u, v, 4));
  return { brightness: .88 + fibre + sapwood * .16 + (mineral - .5) * .04,
    colour: [1 - sapwood * .03, 1 + sapwood * .1, 1 + sapwood * .16], height: .5 + fibre + (grain - .5) * .015,
    roughness: 186 + weather * 22 };
};

/** Walnut: deep brown with a wavy figure and darker heartwood streaks. */
const walnutGrain = ({ grain, mineral, u, v, weather }: SurfaceCoordinate): RomanSurfaceDetail => {
  const wave = Math.sin(v * Math.PI * 4 + u * Math.PI * 6) * .6 + periodicNoise(u, v, 4) * 1.2;
  const figure = Math.sin((u * 16 + wave) * Math.PI * 2);
  const streak = smoothstep(.55, .8, periodicNoise(u, v, 8));
  return { brightness: .9 + figure * .07 - streak * .2 + (mineral - .5) * .05,
    colour: [1, .97, 1.02], height: .5 + figure * .06 - streak * .05 + (grain - .5) * .02,
    roughness: 178 + weather * 20 };
};

/** Mahogany: interlocked ribbon stripe (alternating sheen bands) and a satin finish. */
const mahoganyGrain = ({ grain, mineral, u, v, weather }: SurfaceCoordinate): RomanSurfaceDetail => {
  const ribbon = Math.sin((u * 10 + periodicNoise(u, v, 4) * .8) * Math.PI * 2);
  const fibre = Math.sin((u * 90 + Math.sin(v * Math.PI * 2) * .3) * Math.PI * 2) * .02;
  return { brightness: .88 + ribbon * .09 + fibre + (mineral - .5) * .04,
    colour: [1.02, .98, .97], height: .5 + ribbon * .03 + fibre + (grain - .5) * .012,
    roughness: 150 + weather * 26 - ribbon * 12 };
};

/**
 * Level-1 deck poles seen from above: one round pole per row, lit on its crown and dark in the gaps,
 * with grain along its length and a little bark left at the edges.
 */
const poleRows: SurfaceSampler = ({ grain, mineral, u, v, weather }) => {
  const coordinate = u * POLES_PER_TILE, across = coordinate - Math.floor(coordinate);
  const pole = wrapIndex(Math.floor(coordinate), POLES_PER_TILE);
  const crown = Math.sin(Math.PI * across), bark = smoothstep(0.12, 0, Math.min(across, 1 - across));
  const fibre = Math.sin((v * 22 + blockVariation(pole, 3) * 4) * Math.PI * 2) * 0.03;
  const tone = (blockVariation(pole, 7) - .5) * .12;
  return { brightness: .42 + crown * .55 + fibre + tone - bark * .2 + (mineral - .5) * .04,
    colour: [1 - bark * .05, 1 - bark * .08, 1 - bark * .1], height: crown * .8 + fibre + (grain - .5) * .02,
    roughness: 210 + weather * 30 + bark * 20 };
};

const softwoodGrain: SurfaceSampler = point => ({ ...hardwoodGrain(point), colour: [1, .98, .94] });

const GRAINS: Readonly<Record<BridgeTierTimber, SurfaceSampler>> = {
  cedar: cedarGrain, hardwood: hardwoodGrain, mahogany: mahoganyGrain, softwood: softwoodGrain, walnut: walnutGrain
};

/** The same grain cut into fitted deck boards: dark seams, butt joints and a tone per board. */
const boarded = (timber: SurfaceSampler): SurfaceSampler => point => {
  const detail = timber(point);
  const coordinate = point.u * BOARDS_PER_TILE;
  const board = wrapIndex(Math.floor(coordinate), BOARDS_PER_TILE);
  const seam = smoothstep(0, .06, seamDistance(coordinate));
  const joint = blockVariation(board, 4) > .5 ? smoothstep(0, .008, seamDistance(point.v - blockVariation(board, 5))) : 1;
  const solid = seam * joint, tone = (blockVariation(board, 6) - .5) * .1;
  return { ...detail, brightness: detail.brightness * (.6 + solid * .4) + tone,
    height: detail.height * (.3 + solid * .7), roughness: detail.roughness + (1 - solid) * 20 };
};

/** Sampler of a tier timber for beams and posts (`wood`) or deck boards (`planks`). */
export const bridgeTimberSampler = (tier: BridgeTierTimber, boards: boolean): SurfaceSampler => {
  if (!boards) return GRAINS[tier];
  return tier === "softwood" ? poleRows : boarded(GRAINS[tier]);
};
