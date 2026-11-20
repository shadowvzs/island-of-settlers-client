import type { Object3D } from "three";

/** Root marker used by the spike to give substituted materials a readable category colour. */
export const SPIKE_CATEGORY_KEY = "webgpuSpikeCategory";

/** The nearest categorised ancestor, or `default` when the object is outside the tagged scene graph. */
export const spikeCategoryOf = (object: Object3D | null) => {
  for (let current: Object3D | null = object; current !== null; current = current.parent) {
    const category = current.userData[SPIKE_CATEGORY_KEY];
    if (typeof category === "string") return category;
  }
  return "default";
};
