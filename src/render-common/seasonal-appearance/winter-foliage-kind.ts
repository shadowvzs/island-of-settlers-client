import { EVERGREEN_REGIONS } from "../trees/foliage-atlas";

/** Matches the established foliage atlas and the untextured hardwood-leaf UV sentinel. */
export const getWinterFoliageKind = (u: number, v: number): "wood" | "evergreen" | "deciduous" => {
  if (u > -1.4 && u < -1.1) return "deciduous";
  if (u < 0) return "wood";
  const { needles, palms } = EVERGREEN_REGIONS;
  if (u < needles.u1 && v >= needles.v0 && v < needles.v1) return "evergreen";
  if (v >= palms.v0 && v < palms.v1) return "evergreen";
  return "deciduous";
};
