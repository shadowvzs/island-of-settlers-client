import type { FrameState } from "../../src/render-common/renderer-contract";

/** Read-only callback adapters are materialized once; no live simulation function is retained. */
export const snapshotAtmosphereFrame = (frame: FrameState): FrameState => {
  const { felling, growth, trafficWear, ...plain } = frame;
  const snapshot = structuredClone(plain);
  // The live wear source carries closures; keep only its field data (TrafficWearField).
  const wear = trafficWear && { height: trafficWear.height, pixels: trafficWear.pixels.slice(),
    revision: trafficWear.revision, width: trafficWear.width };
  const felled = Array.from(felling.felledIds());
  const states = new Map(felled.map(id => [id, structuredClone(felling.getState(id))]));
  const standing = structuredClone(felling.getState(-1));
  const leaves = structuredClone(felling.leaves);
  const growing = structuredClone(Array.from(growth.growing()));
  const growingIds = new Set(growing.map(tree => tree.id));
  const grownIds = Array.from(growth.grownIds());
  const grown = new Set(grownIds);
  const revision = growth.revision();
  return {
    ...snapshot,
    ...(wear ? { trafficWear: wear } : {}),
    felling: {
      felledIds: () => felled.values(),
      getState: id => states.get(id) ?? standing,
      leaves
    },
    growth: {
      growing: () => growing.values(),
      grownIds: () => grownIds.values(),
      isGrown: id => grown.has(id),
      isGrowing: id => growingIds.has(id),
      revision: () => revision
    }
  };
};
