import { clamp, float, length, max, min, mix, smoothstep, vec2, vec3 } from "three/tsl";

import { RUIN_SCORCH } from "../../../render-common/ruin-scorch";
import { GROUND_SCORCH_TUNING } from "../../../render-common/shaders/ground-scorch-glsl";
import { getVariantNoise } from "./terrain-variants";
import { bindScalar, bindVectorArray, type UniformBindings } from "./uniform-bindings";

type TslNode = any; // TSL's generated types do not model the proxied node methods;

const tuning = GROUND_SCORCH_TUNING;

/**
 * `scorchGrassKeep` of ground-scorch-glsl.ts: the grass cover kept over the ruin discs (unrolled; a disc past
 * `uScorchCount` has strength 0). Without scorch uniforms the cover is kept whole.
 */
export const createTslScorchGrassKeep = (bindings: UniformBindings) => {
  if (!bindings.source.uScorch) return (): TslNode => float(1);
  const discs = bindVectorArray(bindings, "uScorch", RUIN_SCORCH.maxDiscs, 4);
  const count = bindScalar(bindings, "uScorchCount") as TslNode;
  return (root: TslNode): TslNode => {
    let keep: TslNode = float(1);
    discs.forEach((disc: TslNode, index) => {
      const live = count.greaterThan(index).select(1, 0) as TslNode;
      const distance = length(root.sub(disc.xy)).div(max(disc.z, 0.01)) as TslNode;
      const burn = float(1).sub(smoothstep(tuning.grass[0], tuning.grass[1], distance)).mul(disc.w).mul(live);
      keep = min(keep, float(1).sub(burn)) as TslNode;
    });
    return keep;
  };
};

/**
 * `applyRuinScorch` of ground-scorch-glsl.ts: the ruin discs unrolled (a disc past `uScorchCount` has strength 0,
 * so it adds nothing). The TSL twin keeps the blended roughness.
 */
export const applyTslRuinScorch = (albedo: TslNode, xz: TslNode, bindings: UniformBindings) => {
  if (!bindings.source.uScorch) return albedo;
  const discs = bindVectorArray(bindings, "uScorch", RUIN_SCORCH.maxDiscs, 4);
  const count = bindScalar(bindings, "uScorchCount") as TslNode;
  let burn: TslNode = vec2(0);
  discs.forEach((disc: TslNode, index) => {
    const live = count.greaterThan(index).select(1, 0) as TslNode;
    const edge = getVariantNoise(xz.mul(0.9).add(disc.xy)).sub(0.5).mul(tuning.edgeNoise) as TslNode;
    const distance = length(xz.sub(disc.xy)).div(max(disc.z, 0.01)).add(edge) as TslNode;
    const ring = float(1).sub(smoothstep(tuning.ring[0], tuning.ring[1], distance)) as TslNode;
    const core = float(1).sub(smoothstep(tuning.core[0], tuning.core[1], distance)) as TslNode;
    burn = max(burn, vec2(ring, core).mul(disc.w).mul(live)) as TslNode;
  });
  const turned = vec2(xz.x.mul(0.8).sub(xz.y.mul(0.6)), xz.x.mul(0.6).add(xz.y.mul(0.8))) as TslNode;
  const bits = getVariantNoise(turned.mul(3.7).add(11)) as TslNode;
  const sooty = mix(vec3(...tuning.soot), vec3(...tuning.charcoal), smoothstep(0.6, 0.78, bits)) as TslNode;
  const soot = mix(sooty, vec3(...tuning.fleck),
    smoothstep(0.8, 0.92, getVariantNoise(xz.mul(4.3).add(5))).mul(0.5)) as TslNode;
  const ash = vec3(...tuning.ash).mul(mix(0.88, 1.1, getVariantNoise(xz.mul(1.3).add(2)))) as TslNode;
  const core = clamp(burn.y.div(max(burn.x, 1e-3)), 0, 1) as TslNode;
  return mix(albedo, mix(ash, soot, core), burn.x.mul(tuning.share)) as TslNode;
};
