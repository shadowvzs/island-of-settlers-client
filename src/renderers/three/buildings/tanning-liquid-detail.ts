import type { SurfaceSampler } from "./surface-detail-common";

/** Subdued tannin clouds and crossing capillary ripples, with a glossy liquid response. */
export const tanningLiquidDetail: SurfaceSampler = ({ grain, u, v }) => {
  const radius = Math.hypot(u - .37, v - .61);
  const ripple = Math.sin(radius * 89) * .012 + Math.sin(u * 21 + v * 14) * .008;
  const cloud = Math.sin(u * 9 + Math.sin(v * 7)) * Math.sin(v * 8 - u * 3);
  return { brightness: .92 + cloud * .085 + grain * .012,
    colour: [1, .96 + cloud * .025, .83], height: .5 + ripple,
    roughness: 53 + cloud * 7 };
};

