import { abs, texture, vec3 } from "three/tsl";
import type { Texture } from "three/webgpu";

import { ROCK_TILE } from "../../../render-common/shaders/rock-tuning";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

export interface RockUv {
  weights: TslNode;
  x: TslNode;
  y: TslNode;
  z: TslNode;
}

/** Soft projection blend (a sharp exponent shows seams on 45 degree faces). */
export const getRockUv = (world: TslNode, normal: TslNode): RockUv => {
  const weights = abs(normal).pow(vec3(2.5));
  const total = weights.x.add(weights.y).add(weights.z);
  return {
    weights: weights.div(total),
    x: world.zy.mul(ROCK_TILE),
    y: world.xz.mul(ROCK_TILE),
    z: world.xy.mul(ROCK_TILE)
  };
};

/**
 * Height-aware triplanar blend: where projections overlap, the higher rock (texture R) wins a
 * little, so the seam follows the stone pattern instead of a straight blend band.
 */
export const sampleRockTriplanar = (map: Texture, uv: RockUv): TslNode => {
  const sampleX = texture(map, uv.x);
  const sampleY = texture(map, uv.y);
  const sampleZ = texture(map, uv.z);
  const heights = vec3(sampleX.r, sampleY.r, sampleZ.r).mul(0.8).add(0.6);
  const weights = uv.weights.mul(heights);
  const total = weights.x.add(weights.y).add(weights.z);
  return sampleX.mul(weights.x).add(sampleY.mul(weights.y)).add(sampleZ.mul(weights.z))
    .div(total);
};
