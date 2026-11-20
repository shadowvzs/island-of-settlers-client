import type { SurfaceSampler } from "./surface-detail-common";

/** Recessed grey binder between actual modeled stones; never a painted imitation stone facing. */
export const indigenousRubbleDetail: SurfaceSampler = ({ grain, mineral, weather }) => ({
  brightness: 1 + (mineral - .5) * .035 + (grain - .5) * .025 - weather * .015,
  colour: [1, 1, .995],
  height: .5 + (grain - .5) * .065 + (mineral - .5) * .040,
  roughness: 240 + weather * 12
});
