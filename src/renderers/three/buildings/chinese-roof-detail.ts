import type { SurfaceSampler } from "./surface-detail-common";

/** Fine fired-clay mineral grain; actual pan/cover geometry supplies the large ceramic relief. */
export const chineseGlazedTileDetail: SurfaceSampler = ({ grain, mineral, weather }) => ({
  brightness: .91 + grain * .055 + mineral * .035 - weather * .015,
  colour: [1, 1, 1],
  height: .5 + grain * .008 + mineral * .004,
  roughness: 195 + weather * 20 + mineral * 10
});
