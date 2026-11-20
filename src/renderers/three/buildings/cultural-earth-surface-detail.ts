import { smoothstep } from "../../../shared/world/noise";
import { periodicNoise } from "./roman-texture-grain";
import { blockVariation, seamDistance, type SurfaceSampler, wrapIndex } from "./surface-detail-common";

/** Lime-washed Persian masonry: staggered vertical joints, narrow beds and softly worn block faces. */
export const persianStuccoDetail: SurfaceSampler = ({ grain, mineral, u, v, weather }) => {
  const slow = periodicNoise(u, v, 4), fine = periodicNoise(u, v, 16);
  const sweep = Math.sin((u * 2 + v * 3 + slow * .6) * Math.PI * 2);
  const course = v * 4;
  const row = wrapIndex(Math.floor(course), 4);
  const across = u * 3 + (row % 2) * .5;
  const edge = Math.min(seamDistance(course) / 4, seamDistance(across) / 3);
  const face = smoothstep(.003, .011, edge);
  const tone = blockVariation(wrapIndex(Math.floor(across), 3), row + 9) - .5;
  const chisel = Math.sin((u * 39 + v * 8 + fine * .35) * Math.PI * 2);
  const burnish = smoothstep(.4, .7, slow);
  const pore = grain < .02 ? 1 : 0;
  return {
    brightness: 1 + (weather - .5) * .022 + (mineral - .5) * .014 + (grain - .5) * .01 +
      sweep * .009 + tone * .035 - (1 - face) * .15 - pore * .025,
    colour: [1.008 + (mineral - .5) * .008, 1, .988 - (mineral - .5) * .006],
    height: .35 + face * .24 + sweep * .035 + (fine - .5) * .018 + chisel * .009 - pore * .035,
    roughness: 230 - burnish * 15 + pore * 8
  };
};

/** Small pale vault tiles, rubbed with lime: soft edges and fine comb marks, visibly separate from adobe. */
export const persianVaultDetail: SurfaceSampler = ({ grain, mineral, u, v, weather }) => {
  const course = v * 10, row = wrapIndex(Math.floor(course), 10);
  const across = u * 12 + row % 2 * .5, column = wrapIndex(Math.floor(across), 12);
  const edge = Math.min(seamDistance(course) / 10, seamDistance(across) / 12);
  const face = smoothstep(.0025, .008, edge);
  const tone = blockVariation(column + row * 5, row + 17) - .5;
  const rub = Math.sin((u * 18 + v * 3 + periodicNoise(u, v, 8) * .25) * Math.PI * 2);
  return {
    brightness: 1 + tone * .035 + (weather - .5) * .025 + (grain - .5) * .012 +
      rub * .006 - (1 - face) * .13,
    colour: [1.012, 1, .978 + (mineral - .5) * .008],
    height: .30 + face * .29 + rub * .012 + (mineral - .5) * .022 + (grain - .5) * .014,
    roughness: 227 + (1 - face) * 17 + (mineral - .5) * 8
  };
};

/** Large irregular Nubian adobe blocks: chopped fibre, pressed faces and deeply recessed mud beds. */
export const nubianAdobeDetail: SurfaceSampler = ({ grain, mineral, u, v, weather }) => {
  const wobble = (periodicNoise(u, v, 8) - .5) * .10;
  const course = v * 6 + wobble, row = wrapIndex(Math.floor(course), 6);
  const across = u * 3 + row % 2 * .5 + (periodicNoise(u, v, 16) - .5) * .065;
  const column = wrapIndex(Math.floor(across), 3);
  const edge = Math.min(seamDistance(course) / 6, seamDistance(across) / 3);
  const face = smoothstep(.006 + mineral * .002, .017, edge);
  const tone = blockVariation(column + row * 7, row + 23) - .5;
  const fibre = smoothstep(.91, .96, grain) * smoothstep(.70, .9,
    Math.sin((u * 71 + v * 9 + mineral * .4) * Math.PI * 2) * .5 + .5);
  const grit = (periodicNoise(u, v, 32) - .5) * .07;
  const pit = grain < .02 ? 1 : 0;
  return {
    brightness: 1 + tone * .035 + (weather - .5) * .023 + (mineral - .5) * .012 +
      fibre * .014 - pit * .035 - (1 - face) * .14,
    colour: [1.012 + tone * .008, 1, .978 - tone * .008],
    height: .11 + face * .64 + grit + fibre * .07 + (mineral - .5) * .035 - pit * .09,
    roughness: 243 + (1 - face) * 8 - fibre * 4
  };
};

/** Coarse roof earth pressed over woven mats: tamped patches, rake impressions and hairline drying cracks. */
export const nubianPressedRoofDetail: SurfaceSampler = ({ grain, mineral, u, v, weather }) => {
  const packed = periodicNoise(u, v, 8), clods = periodicNoise(u, v, 32);
  const rake = Math.sin((u * 17 + v * 4 + packed * .7) * Math.PI * 2);
  const crackField = periodicNoise(u, v, 4) * .55 + periodicNoise(u, v, 16) * .45;
  const crack = Math.exp(-(((crackField - .5) / .008) ** 2)) *
    smoothstep(.56, .78, periodicNoise(u + .31, v + .13, 4));
  const fibre = grain > .96 ? .03 : 0;
  const pit = grain < .025 ? .025 : 0;
  return {
    brightness: 1 + (weather - .5) * .025 + (packed - .5) * .025 +
      (grain - .5) * .012 + rake * .008 - crack * .10 + fibre * .35 - pit,
    colour: [1.018, 1, .976 + (mineral - .5) * .006],
    height: .49 + (packed - .5) * .17 + (clods - .5) * .075 + rake * .032 - crack * .16 + fibre - pit,
    roughness: 245 + mineral * 8 - fibre * 10
  };
};
