import { clamp, texture, vec2 } from "three/tsl";

import { bindScalar, bindTexture, bindVector, type UniformBindings } from "./uniform-bindings";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

/**
 * TSL twin of `sampleLiveFog` (common-glsl): the live fog map replaces the baked visibility while
 * `uLiveFog` is on and the scene has a map. Materials without a fog map keep the baked value.
 */
export const createLiveFogSampler = (bindings: UniformBindings) => {
  if (!bindings.source.uFogMap?.value) return (visibility: TslNode) => visibility;
  const fogMap = bindTexture(bindings, "uFogMap");
  const live = bindScalar(bindings, "uLiveFog", 0);
  const worldSize = bindVector(bindings, "uWorldSize", 2);
  return (visibility: TslNode, xz: TslNode): TslNode => {
    const sample = texture(fogMap, clamp(xz.div(worldSize.max(vec2(1e-6))), 0, 1)).r;
    const off = live.lessThan(0.5).or(worldSize.x.lessThanEqual(0));
    return off.select(visibility, sample);
  };
};
