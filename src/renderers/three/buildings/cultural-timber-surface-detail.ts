import { fract, smoothstep } from "../../../shared/world/noise";
import { periodicNoise } from "./roman-texture-grain";
import { blockVariation, seamDistance, type SurfaceSampler } from "./surface-detail-common";
import { limePlasterDetail, plankDetail } from "./wall-surface-detail";

/** Smooth clay-lime infill carries broad trowel marks and fine fibres between the Chinese frame bays. */
export const chineseRenderDetail: SurfaceSampler = point => {
  const base = limePlasterDetail(point), { grain, u, v } = point;
  const sweep = Math.sin(v * Math.PI * 10 + Math.sin(u * Math.PI * 2) * .6) * .018;
  return { ...base, brightness: base.brightness + sweep * .35,
    colour: [1.015, 1, .98], height: base.height * .6 + .2 + sweep + (grain - .5) * .012,
    roughness: 221 + point.weather * 12 };
};

/** Fine pale Japanese wall render has a smaller, quieter grain than the broad Chinese tool marks. */
export const japaneseRenderDetail: SurfaceSampler = point => {
  const { grain, mineral, u, v, weather } = point;
  const polish = Math.sin(u * Math.PI * 6 + v * Math.PI * 4) * .012;
  return { brightness: 1 + (mineral - .5) * .025 + (weather - .5) * .015,
    colour: [.99, 1, 1.012], height: .5 + polish + (grain - .5) * .025,
    roughness: 224 + grain * 12 };
};

/** Broad hewn stave grain, blunt splits and adze scallops remain readable at ordinary game zoom. */
export const vikingStaveDetail: SurfaceSampler = point => {
  const base = plankDetail(point), { grain, u, v } = point;
  const board = Math.floor(u * 5), across = fract(u * 5);
  const knotHeight = blockVariation(board, 29);
  const knot = Math.max(0, 1 - Math.hypot((across - .5) * 3.5, (v - knotHeight) * 6));
  const flow = Math.sin((u * 40 + knot * .35 + Math.sin(v * Math.PI * 2) * .1) * Math.PI);
  const split = Math.exp(-seamDistance(u * 5 + periodicNoise(u, v, 8) * .08) * 140);
  const adze = Math.sin(v * Math.PI * 18 + across * 2) * .018;
  return { brightness: base.brightness * .96 + flow * .025 - split * .1 - knot * .035,
    colour: [1.035, 1, .95], height: .5 + flow * .06 + adze - split * .12 - knot * .04 + (grain - .5) * .02,
    roughness: 224 + point.weather * 20 };
};

/** Planed cedar has finer longitudinal fibres and restrained knots instead of coarse Viking adze cuts. */
export const japaneseTimberDetail: SurfaceSampler = point => {
  const { grain, mineral, u, v, weather } = point;
  const curve = Math.sin(v * Math.PI * 2) * .3;
  const fibre = Math.sin(u * Math.PI * 70 + curve) * .025;
  const fine = Math.sin(u * Math.PI * 180 + curve * 2) * .008;
  return { brightness: .98 + fibre + fine + (mineral - .5) * .025,
    colour: [1.025, 1, .97], height: .5 + fibre * .6 + fine + (grain - .5) * .014,
    roughness: 194 + weather * 16 };
};

/** Keep planed cedar fibres while showing the individual fitted boards of doors and plankwork. */
export const japanesePlankDetail: SurfaceSampler = point => {
  const timber = japaneseTimberDetail(point);
  const seam = smoothstep(0, .055, seamDistance(point.u * 6));
  const board = Math.floor(point.u * 6), tone = (blockVariation(board, 6) - .5) * .07;
  return { ...timber, brightness: timber.brightness - (1 - seam) * .28 + tone,
    height: timber.height - (1 - seam) * .22 };
};
