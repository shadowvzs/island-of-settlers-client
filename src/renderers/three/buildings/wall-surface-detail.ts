import { fract, smoothstep } from "../../../shared/world/noise";
import { periodicNoise } from "./roman-texture-grain";
import {
  blockVariation, type RomanSurfaceDetail, seamDistance, type SurfaceCoordinate,
wrapIndex} from "./surface-detail-common";

/**
 * Wall textures are mapped in recipe units (one tile per unit, see `worldUv`), so a brick, board or
 * crack keeps its size on every wall instead of stretching with the wall box.
 */
const BRICK_COURSES = 12;
const BRICKS_PER_COURSE = 5;
const BOARDS_PER_TILE = 8;

/** Mud render still clinging to the brickwork: rare, so the coursing stays the wall's main read. */
const renderPatch = (u: number, v: number) =>
  smoothstep(.75, .78, periodicNoise(u, v, 4) * .55 + periodicNoise(u + .31, v + .17, 16) * .45);

/** Sun-dried mud brick: staggered courses, irregular arrises, recessed mud mortar, light erosion. */
export const mudBrickDetail = ({ grain, mineral, u, v, weather }: SurfaceCoordinate): RomanSurfaceDetail => {
  const bedWobble = (periodicNoise(u, v, 8) - .5) * .16;
  const courseCoordinate = v * BRICK_COURSES + bedWobble;
  const row = wrapIndex(Math.floor(courseCoordinate), BRICK_COURSES);
  const shift = (row % 2) * .5 + (blockVariation(row, 3) - .5) * .24;
  const columnCoordinate = u * BRICKS_PER_COURSE + shift + (periodicNoise(u, v, 32) - .5) * .1;
  const brick = wrapIndex(Math.floor(columnCoordinate), BRICKS_PER_COURSE);
  // Joint distances in tile units: brick faces are 0.2 long and 0.083 high.
  const edge = Math.min(seamDistance(columnCoordinate) / BRICKS_PER_COURSE,
    seamDistance(courseCoordinate) / BRICK_COURSES);
  const erosion = smoothstep(.5, .85, weather);
  const mortar = .005 + (mineral - .5) * .004 + (grain - .5) * .0025 + erosion * .004;
  const face = smoothstep(mortar, mortar + .007 + erosion * .005, edge);
  const tone = blockVariation(brick + row * 7, row) - .5;
  const straw = grain > .965 ? .018 : 0, pit = grain < .025 ? .05 : 0;
  const patch = renderPatch(u, v);
  // Heights are steep on purpose: the normal map is derived from them per texel.
  const brickHeight = .1 + face * .6 + (mineral - .5) * .08 - pit * .8;
  const brickBrightness = 1 + tone * .045 + (weather - .5) * .025 + (mineral - .5) * .012 +
    (grain - .5) * .008 + straw - pit - (1 - face) * .14;
  const height = brickHeight + patch * (.8 - brickHeight);
  return {
    brightness: brickBrightness + patch * (1 + (grain - .5) * .02 - brickBrightness),
    colour: [1 + tone * .02 + patch * .005, 1 - tone * .008, 1 - tone * .02 + patch * .008],
    height,
    roughness: 236 + (1 - face) * 12 - patch * 10
  };
};

/** Lime plaster: trowel sweeps, repaired patches, sparse hairline cracks and settled grime. */
export const limePlasterDetail = ({ grain, mineral, u, v, weather }: SurfaceCoordinate): RomanSurfaceDetail => {
  const trowel = Math.sin((u * 3 + v * 2 + periodicNoise(u, v, 4) * 1.6) * Math.PI * 4) * .07;
  const patchField = periodicNoise(u + .5, v, 4) * .6 + periodicNoise(u, v + .5, 16) * .4;
  const patch = smoothstep(.61, .64, patchField);
  const patchRim = Math.exp(-(((patchField - .625) / .006) ** 2));
  const crackField = periodicNoise(u, v, 8) * .7 + periodicNoise(u, v, 32) * .3;
  const crackMask = smoothstep(.58, .72, periodicNoise(u + .37, v + .11, 4));
  const crack = Math.exp(-(((crackField - .5) / .0045) ** 2)) * crackMask;
  const grime = smoothstep(.55, .95, weather) * .025;
  return {
    brightness: 1 + (weather - .5) * .035 + (mineral - .5) * .02 + (grain - .5) * .012 + trowel * .1
      - patch * .018 - patchRim * .025 - crack * .16 - grime,
    colour: [1 + patch * .015, 1, 1 - patch * .035 - grime * .2],
    height: .5 + trowel + patch * .012 - patchRim * .01 - crack * .14 + (grain - .5) * .012,
    roughness: 222 + weather * 22 + crack * 10
  };
};

/** Knot centre of one board, in board-local (across, along) coordinates. */
const boardKnot = (board: number, across: number, v: number) => {
  const centre = .3 + blockVariation(board, 21) * .4, height = blockVariation(board, 22);
  const along = (fract(v - height + .5) - .5) * 4;
  return Math.max(0, 1 - Math.hypot(across - centre, along) * 4.5);
};

/** Upright split boards (stave walls, gables, skirting): seams, butt joints, grain and knots. */
export const plankDetail = ({ grain, mineral, u, v, weather }: SurfaceCoordinate): RomanSurfaceDetail => {
  const boardCoordinate = u * BOARDS_PER_TILE + (periodicNoise(u, v, 8) - .5) * .05;
  const board = wrapIndex(Math.floor(boardCoordinate), BOARDS_PER_TILE), across = fract(boardCoordinate);
  const seam = smoothstep(.0, .06, seamDistance(boardCoordinate));
  const joint = blockVariation(board, 4) > .5
    ? smoothstep(0, .006, seamDistance(v - blockVariation(board, 5))) : 1;
  const knot = boardKnot(board, across, v);
  const flow = Math.sin(v * Math.PI * 4 + board * 1.7) * .5 + knot * 5;
  const fibres = Math.sin((across * 7 + flow * .35) * Math.PI * 2);
  const fine = Math.sin((across * 23 + flow * .7) * Math.PI * 2) * .025;
  const tone = blockVariation(board, 6) - .5;
  const solid = seam * joint;
  const pattern = fibres * .06 + fine - knot * .2 + tone * .14;
  return {
    brightness: .62 + solid * .32 + pattern + weather * .18 + (grain - .5) * .03,
    colour: [1.03 - tone * .04, 1, .97 + tone * .05],
    height: .1 + solid * .6 + fibres * .06 + fine * .8 - knot * .08 + (mineral - .5) * .03,
    roughness: 205 + weather * 40 + (1 - solid) * 10
  };
};
