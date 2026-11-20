import { float, normalize, vec2, vec4 } from "three/tsl";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

/** GLSL EXPLORATION_VIEW_RAY_GLSL: the world-space view ray of a fullscreen position (NDC). */
export const createSkyViewRay = (screen: TslNode, inverseProjection: TslNode,
  cameraWorld: TslNode) => {
  const nearPoint = inverseProjection.mul(vec4(screen, -1, 1));
  const farPoint = inverseProjection.mul(vec4(screen, 1, 1));
  const origin = cameraWorld.mul(vec4(nearPoint.xyz.div(nearPoint.w), 1)).xyz;
  const target = cameraWorld.mul(vec4(farPoint.xyz.div(farPoint.w), 1)).xyz;
  return { direction: normalize(target.sub(origin)), origin };
};

/**
 * Fullscreen pass UV (Three's `QuadMesh`: y = 0 at the top of the target) to NDC and back. A
 * target texel written at pass UV `u` is read again at texture UV `u`, so the sky samples the
 * cloud targets at `cloudUvOfNdc(its own NDC)`.
 */
export const ndcOfPassUv = (uv: TslNode): TslNode =>
  vec2(uv.x.mul(2).sub(1), float(1).sub(uv.y.mul(2)));

export const cloudUvOfNdc = (ndc: TslNode): TslNode =>
  vec2(ndc.x.mul(0.5).add(0.5), float(0.5).sub(ndc.y.mul(0.5)));
