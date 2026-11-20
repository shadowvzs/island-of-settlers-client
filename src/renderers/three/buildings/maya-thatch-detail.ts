import type { SurfaceSampler } from "./surface-detail-common";
import { sampleThatchFibres } from "./thatch-fibre-atlas";

/** Golden dry maize/palm stalks retain fine separate fibres beneath the overlapping roof courses. */
export const mayaThatchDetail: SurfaceSampler = ({ grain, u, v, weather }) => {
  const sampled = sampleThatchFibres(u * 2, v * 2);
  const colour: [number, number, number] = [Math.min(1, sampled[0] * 1.035),
    Math.min(1, sampled[1] * 1.025), sampled[2] * .97];
  const light = sampled[0] * .3 + sampled[1] * .59 + sampled[2] * .11;
  return { brightness: .98 + grain * .025 - weather * .012, colour,
    height: .15 + light * .7, roughness: 232 + weather * 18 };
};
