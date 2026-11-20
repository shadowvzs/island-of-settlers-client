import type { SurfaceSampler } from "./surface-detail-common";

/** A narrow blade's parallel veins branch from a pale midrib beneath its waxy green surface. */
export const bambooLeafDetail: SurfaceSampler = ({ grain, mineral, u, v, weather }) => {
  const across = Math.abs(u - .5) * 2;
  const midrib = Math.exp(-Math.abs(u - .5) * 120);
  const diagonal = v * 30 - across * 4.2;
  const veins = Math.pow(.5 + .5 * Math.cos(diagonal * Math.PI * 2), 16) * (1 - across * .45);
  const fibres = Math.cos(u * Math.PI * 190) * .012;
  return {
    brightness: .91 + grain * .045 + fibres + midrib * .1 + veins * .07 - weather * .015,
    colour: [.84 + mineral * .045, 1, .76],
    height: .4 + midrib * .22 + veins * .055 + fibres,
    roughness: 174 + across * 28 + weather * 10
  };
};
