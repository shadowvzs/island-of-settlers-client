import { Fn, texture } from "three/tsl";
import type { Texture } from "three/webgpu";

import { NOISE_LATTICE, NOISE_TEXTURE_SIZE } from "../../../render-common/noise-textures";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

/**
 * TSL twin of `NOISE_GLSL` (common-glsl): one tileable noise texture sampled with the same
 * nearest/repeat rules. The material port binds `uNoiseTexture`; tests use the CPU reference.
 */
export const createNoiseNodes = (source: Texture) => {
  // Sample the Texture itself: a clone of a uv-less `texture(source)` node keeps the uv-matrix
  // transform, whose uniform Three refreshes per object per frame (C-3: ~3 ms/frame in the town).
  const sample = (point: TslNode): TslNode => texture(source, point.div(NOISE_LATTICE));

  const valueNoise = Fn(([point]: [TslNode]) => sample(point).r);
  const valueNoise4 = Fn(([point]: [TslNode]) => sample(point));
  const fbm3 = Fn(([point]: [TslNode]) => sample(point).r.mul(0.5)
    .add(sample(point.mul(2.03).add(17.1)).g.mul(0.3))
    .add(sample(point.mul(4.01).add(3.7)).b.mul(0.2)));

  return { fbm3, valueNoise, valueNoise4 };
};

/** Texture count/period shared by the TSL and CPU reference (not used in the node graph). */
export const NOISE_REFERENCE = { lattice: NOISE_LATTICE, size: NOISE_TEXTURE_SIZE } as const;
