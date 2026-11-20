import type { SurfaceSampler } from "./surface-detail-common";
import { sampleThatchFibres } from "./thatch-fibre-atlas";

/** Individual split palm fibres and frayed cut ends, with shallow relief rather than wood blocks. */
export const palmThatchDetail: SurfaceSampler = ({ grain, u, v, weather }) => {
  const colour = sampleThatchFibres(u * 6, v * 2);
  const light = colour[0] * .3 + colour[1] * .59 + colour[2] * .11;
  return { brightness: .96 + grain * .035 - weather * .018, colour,
    height: .15 + light * .7 + (grain - .5) * .012, roughness: 228 + weather * 20 };
};
