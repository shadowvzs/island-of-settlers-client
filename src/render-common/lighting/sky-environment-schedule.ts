import { SKY_SH_FLOATS, type SkyLight } from "./sky-irradiance";

/**
 * When the R05 environment reflection (PMREM, Medium+) is baked again. A bake costs a few GPU
 * passes, so it follows the slowly drifting sky at most once a minute and catches up at once only
 * after a large light change (dawn, dusk, a weather front). Pure and allocation-free per call.
 */

/** Ordinary sky drift is baked at most this often. */
export const SKY_ENVIRONMENT_INTERVAL_SECONDS = 60;
/** A large change (relative to the baked average sky radiance) is baked at once. */
export const SKY_ENVIRONMENT_LARGE_CHANGE = 0.2;
/** Even large changes never bake closer together than this (hitch guard). */
export const SKY_ENVIRONMENT_MIN_SECONDS = 2;

/** Largest coefficient change, relative to the baked average radiance of its channel. */
const relativeChange = (baked: Float32Array, current: Float32Array) => {
  let change = 0;
  for (let slot = 0; slot < SKY_SH_FLOATS; slot++) {
    const average = Math.max(Math.abs(baked[slot % 3]!), 1e-3);
    change = Math.max(change, Math.abs(current[slot]! - baked[slot]!) / average);
  }
  return change;
};

/** Returns a predicate: true when the environment should be baked from `light` now. */
export const createSkyEnvironmentSchedule = () => {
  const baked = new Float32Array(SKY_SH_FLOATS);
  let bakedRevision = -1;
  let bakedAt = -Infinity;
  return (light: SkyLight, nowSeconds: number) => {
    if (light.revision === bakedRevision) return false;
    const elapsed = nowSeconds - bakedAt;
    const due = bakedRevision < 0 || elapsed >= SKY_ENVIRONMENT_INTERVAL_SECONDS ||
      (elapsed >= SKY_ENVIRONMENT_MIN_SECONDS &&
        relativeChange(baked, light.radiance) > SKY_ENVIRONMENT_LARGE_CHANGE);
    if (!due) return false;
    baked.set(light.radiance);
    bakedRevision = light.revision;
    bakedAt = nowSeconds;
    return true;
  };
};
