import { fract, smoothstep } from "../../../shared/world/noise";
import type { SurfaceSampler } from "./surface-detail-common";
import { sampleThatchFibres } from "./thatch-fibre-atlas";

/** Split, dried palm fans retain a main rib and diagonal leaf veins within overlapped courses. */
export const mayaPalmRoofDetail: SurfaceSampler = ({ grain, u, v, weather }) => {
  const row = Math.floor(v * 3), across = fract(u * 4 + (row % 2) * .5);
  const along = fract(v * 3), distance = Math.abs(across - .5);
  const rib = 1 - smoothstep(.012, .033, distance);
  const veins = Math.sin((along * 26 + distance * 18) * Math.PI) * .5 + .5;
  const edge = smoothstep(.005, .04, Math.min(across, 1 - across, along));
  const fibre = sampleThatchFibres(u * 3, v);
  return { brightness: .93 + edge * .06 + rib * .025 - weather * .015,
    colour: [fibre[0] * 1.04, fibre[1] * 1.055, fibre[2] * .93],
    height: .20 + edge * .48 + rib * .13 + veins * .055 + grain * .025,
    roughness: 233 + weather * 15 };
};

/** Closely packed straight reed culms have fine longitudinal fibres and sparse visible stem nodes. */
export const mayaReedRoofDetail: SurfaceSampler = ({ grain, u, v, weather }) => {
  const fibre = sampleThatchFibres(u * 12, v * 1.7);
  const culm = Math.abs(Math.sin(u * Math.PI * 46));
  const node = 1 - smoothstep(.012, .035, Math.abs(fract(v * 2.8 + Math.floor(u * 23) * .17) - .5));
  return { brightness: .97 - node * .04 + grain * .025 - weather * .012,
    colour: [fibre[0] * .99, fibre[1] * 1.055, fibre[2] * 1.06],
    height: .22 + culm * .35 + node * .07 + grain * .03, roughness: 235 + weather * 12 };
};
