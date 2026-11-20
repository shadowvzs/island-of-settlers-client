import { blockVariation, type SurfaceSampler } from "./surface-detail-common";

/** Thin sun-dried reed stems, tied into panels with horizontal grass cords. */
export const reedMatDetail: SurfaceSampler = ({ grain, mineral, u, v, weather }) => {
  const stem = u * 92 + Math.sin(v * Math.PI * 4) * .13;
  const ridge = Math.pow(.5 + .5 * Math.cos(stem * Math.PI * 2), .55);
  const tone = blockVariation(Math.floor(stem), 4) - .5;
  const cord = Math.pow(.5 + .5 * Math.cos(v * Math.PI * 24 + Math.sin(stem * Math.PI) * .2), 18);
  const fibre = Math.sin(v * 593 + u * 23) * .012;
  return { brightness: .85 + ridge * .15 + tone * .12 + grain * .025 - cord * .13 - weather * .02,
    colour: [1.01 + tone * .025, 1, .82 + mineral * .045],
    height: .34 + ridge * .16 + cord * .085 + fibre,
    roughness: 224 + weather * 18 - ridge * 5 };
};
