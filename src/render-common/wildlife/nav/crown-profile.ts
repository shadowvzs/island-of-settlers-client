import { NATIVE_TREE_CROWN_PROFILES } from "../../trees/tree-crown-profiles";

/** Radial bins of the profile (world units at instance scale 1). */
export const CROWN_BIN = 0.1;
export const CROWN_BINS = 18;
/** Map key of a tree kind's variant profile. */
const getProfileKey = (kind: number, variant: number) => kind * 256 + variant;

/**
 * Radius around a trunk an animal of `height` must keep clear: the outer edge of the farthest
 * ring whose lowest branch hangs below the animal (its back, head or antlers would go into it).
 */
export const getCrownRadius = (profile: Float32Array, height: number) => {
  let radius = 0;
  for (let bin = 0; bin < profile.length; bin += 1) {
    if (profile[bin]! < height) radius = (bin + 1) * CROWN_BIN;
  }
  return radius;
};

const crownProfiles = new Map<number, Float32Array>();

/**
 * Crown profile of an island tree kind's variant: the lowest mesh height in each ring around the
 * trunk (Infinity where nothing is), so lower or wider limbs widen the animals' clearance;
 * undefined for a kind without tree meshes. Baked offline from the tree meshes
 * (tree-crown-profiles.ts), so no mesh is built at runtime.
 */
export const getCrownProfile = (kind: number, variant: number) => {
  const key = getProfileKey(kind, variant);
  const cached = crownProfiles.get(key);
  if (cached) return cached;
  const baked = NATIVE_TREE_CROWN_PROFILES[kind]?.[variant];
  if (!baked) return undefined;
  const profile = Float32Array.from(baked, (lowest) => lowest ?? Infinity);
  crownProfiles.set(key, profile);
  return profile;
};
