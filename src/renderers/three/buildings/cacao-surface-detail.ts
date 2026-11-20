import type { SurfaceSampler } from "./surface-detail-common";

/** Broad leathery blades: continuous midrib, arcing lateral veins and fine waxy mottling. */
export const cacaoLeafDetail: SurfaceSampler = ({ grain, mineral, u, v, weather }) => {
  const across = Math.abs(u - .5) * 2;
  const midrib = Math.exp(-Math.abs(u - .5) * 95);
  const lateral = v * 10 - across * (1.3 + v * .6);
  const veins = Math.pow(.5 + .5 * Math.cos(lateral * Math.PI * 2), 22);
  const fine = Math.sin(u * 183 + v * 57) * Math.sin(v * 149) * .012;
  return { brightness: .85 + grain * .08 + midrib * .2 + veins * .065 + fine - across * .07,
    colour: [.86 + mineral * .06, 1, .88],
    height: .38 + midrib * .24 + veins * .075 + fine,
    roughness: 132 + across * 22 + weather * 12 };
};
