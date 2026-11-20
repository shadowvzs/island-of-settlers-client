import type { BuildingPart } from "./building-recipe";

type RoofProfile = BuildingPart["occupationRoof"];

/** Half-length (unit plan) of a hip roof's ridge; the hips run from its ends to the corners. */
export const HIP_RIDGE_END = 0.3;
export const ACROSS_SLOPE = 1.74;

export const isHippedOccupationRoof = (profile: RoofProfile) => profile === "hip" || profile === "half-hip";
/** Unit-plan slope of a hipped roof's end pitch; the half-hip's shallower end stops above the eave. */
export const getEndSlope = (profile: RoofProfile) => (profile === "half-hip" ? 2.7 : 4.35);

/** Unit height (-0.5 … 0.5) of an occupation roof's tiled surface over unit plan point (x, z). */
const baseOccupationRoofHeight = (profile: RoofProfile, x: number, z: number) => {
  if (profile === "barrel") return -0.44 + 0.87 * Math.sqrt(Math.max(0, 1 - 4 * x * x));
  if (profile === "pyramid") return 0.43 - ACROSS_SLOPE * Math.max(Math.abs(x), Math.abs(z));
  const across = 0.43 - ACROSS_SLOPE * Math.abs(x);
  if (profile === "gable") return across;
  return Math.min(across, 0.43 - getEndSlope(profile) * Math.max(0, Math.abs(z) - HIP_RIDGE_END));
};

/** Shared by native tile meshes, attached ornaments and physical roof queries. */
export const getOccupationRoofHeight = (profile: RoofProfile, x: number, z: number, sweep = 0, curve = 0) => {
  const edge = Math.max(Math.abs(x), Math.abs(z)) * 2;
  const corner = Math.pow(Math.abs(x * z) * 4, 2);
  const base = baseOccupationRoofHeight(profile, x, z);
  const slope = Math.max(0, Math.min(1, (.43 - base) / .87));
  const concavity = Math.max(0, Math.min(1, curve)) * .87 * slope * (1 - slope);
  return base - concavity + sweep * (Math.pow(edge, 4) * .45 + corner * .55);
};
