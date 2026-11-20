import { wareSurfaceResolution } from "../buildings/building-surface-paint";
import type { PaintedSurfaces } from "../buildings/building-surface-textures";
import { createRomanMaterials } from "../buildings/roman-materials";

interface SharedPack {
  refs: number;
  surfaces: ReturnType<typeof createRomanMaterials>;
}
/** One pack per detail level, shared by carried goods, cart cargo and horse loads. */
const packs = new Map<boolean, SharedPack>();

/**
 * Small cargo uses the same PBR surface recipe with proportionate maps shared by the crowd.
 * `painted`: the worker-painted maps, used when this call creates the pack (the renderer
 * acquires it first, so no page painting happens before or after the first frame).
 */
export const acquireWareMaterials = (detailed: boolean, painted?: PaintedSurfaces) => {
  let shared = packs.get(detailed);
  if (!shared) {
    shared = { refs: 0, surfaces: createRomanMaterials(detailed, wareSurfaceResolution(detailed), painted) };
    packs.set(detailed, shared);
  }
  shared.refs++;
  let released = false;
  return {
    materials: shared.surfaces.materials,
    release: () => {
      if (released) return;
      released = true;
      shared!.refs--;
      if (shared!.refs > 0) return;
      shared!.surfaces.dispose();
      packs.delete(detailed);
    }
  };
};
