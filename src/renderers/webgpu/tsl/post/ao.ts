import {
  abs, clamp, cos, cross, float, floor, int, ivec2, length, max, min, mix, normalize, pow,
  round, sign, sin, smoothstep, sqrt, texture, textureLoad, uniform, uv, vec2, vec3, vec4
} from "three/tsl";
import {
  type Camera, DataTexture, FloatType, NearestFilter, RedFormat, type Texture, Vector2,
  Vector4
} from "three/webgpu";

import { ambientOcclusionSize } from "../../../../render-common/post-sizes";
import type { ActiveAmbientOcclusion } from "../../../../render-common/quality";
import {
  AO_BAYER_TILE,
  AO_BLUR_RADIUS,
  AO_BLUR_TENT_WEIGHTS,
  AO_GTAO_SLICES,
  AO_GTAO_STEPS,
  AO_LEVEL_TUNING,
  AO_SKY_VIEW_DEPTH,
  AO_TUNING
} from "../../../../render-common/shaders/frame-ao-glsl";
import { createPassMaterial, type QuadPass } from "./quad-pass";
import { createPostTarget, resizePostTarget } from "./targets";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

const PI = Math.PI;
const HALF_PI = Math.PI / 2;

/** The 4x4 Bayer tile as a nearest-sampled red texture (the GTAO slice/step rotation). */
const createBayerTexture = () => {
  const data = new Uint8Array(16);
  AO_BAYER_TILE.forEach((value, index) => { data[index] = value; });
  const texture = new DataTexture(data, 4, 4, RedFormat);
  texture.magFilter = texture.minFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
};

const isOrthographic = (camera: Camera) => camera.projectionMatrix.elements[11] === 0;
const texel = (pixel: TslNode) => ivec2(int(pixel.x), int(pixel.y));

export interface TslAmbientOcclusionOptions {
  depthTexture: Texture;
  level: ActiveAmbientOcclusion;
  quad: QuadPass;
}

export interface TslAmbientOcclusion {
  dispose: () => void;
  /** Runs the depth prepass, GTAO and both blur axes into this frame's AO texture. */
  render: (camera: Camera, width: number, height: number) => void;
  resize: (width: number, height: number) => void;
  texture: () => Texture;
  /** Full-resolution visibility factor of a scene pixel after the depth-aware upsample. */
  visibility: (pixel: TslNode, mask: TslNode) => TslNode;
}

/**
 * TSL twin of the R12b ambient occlusion (frame-ao.ts and frame-ao-glsl.ts): half-resolution view
 * depth, GTAO with the 4x4 Bayer rotation, the depth-aware tent blur along x and y, and the
 * full-resolution 2x2 upsample. The direct-sun share stays 0 until the sun shadow map is ported
 * (C-1), so the occlusion darkens the whole pixel as the GLSL pass does without AO-AMBIENT.
 */
export const createTslAmbientOcclusion = (
  options: TslAmbientOcclusionOptions
): TslAmbientOcclusion => {
  const { depthTexture, level, quad } = options;
  const tuning = { ...AO_TUNING, ...AO_LEVEL_TUNING[level] };
  const viewDepthTarget = createPostTarget(1, 1, { format: RedFormat, type: FloatType });
  const occlusionTarget = createPostTarget(1, 1, { filter: NearestFilter, type: FloatType });
  const blurredTarget = createPostTarget(1, 1, { filter: NearestFilter, type: FloatType });
  const bayerTexture = createBayerTexture();

  const halfSize = uniform(new Vector2(1, 1));
  const fullSize = uniform(new Vector2(1, 1));
  const depthToView = uniform(new Vector4(0, -1, 0, 1));
  const unproject = uniform(new Vector4(1, 1, 0, 0));
  const params = uniform(new Vector4(tuning.radius, 1, tuning.maxRadiusPixels, 0));
  const shape = uniform(new Vector2(tuning.falloff, tuning.bias));
  const tolerance = uniform(new Vector2(tuning.depthTolerance.absolute, tuning.depthTolerance.relative));
  const axis = uniform(new Vector2(1, 0));

  const depthNode = texture(depthTexture) as TslNode;
  const viewDepthNode = texture(viewDepthTarget.texture) as TslNode;
  const occlusionNode = texture(occlusionTarget.texture) as TslNode;
  const blurSourceNode = texture(occlusionTarget.texture) as TslNode;
  const bayerNode = texture(bayerTexture) as TslNode;

  const sampleDepth = (pixel: TslNode) => textureLoad(depthNode, texel(pixel)).x as TslNode;
  const sampleViewDepth = (pixel: TslNode) =>
    textureLoad(viewDepthNode, texel(pixel)).x as TslNode;

  /** Linear view depth from a depth-buffer value (AO viewDepthOf). */
  const viewDepthOf = (depth: TslNode) => {
    const ndcZ = depth.mul(2).sub(1);
    return depthToView.x.mul(ndcZ).add(depthToView.y).negate()
      .div(depthToView.z.mul(ndcZ).add(depthToView.w));
  };

  const clampPixel = (pixel: TslNode) => {
    const last = halfSize.sub(1);
    return vec2(clamp(pixel.x, 0, last.x), clamp(pixel.y, 0, last.y));
  };

  /** Texel i stands for full-resolution pixel 2i, whose NDC centre is (4i + 1) / fullSize - 1. */
  const viewPositionAt = (pixel: TslNode, viewDepth: TslNode) => {
    const ndc = pixel.mul(4).add(1).div(fullSize).sub(1);
    const xy = ndc.sub(vec2(unproject.z, unproject.w))
      .mul(vec2(unproject.x, unproject.y))
      .mul(mix(viewDepth, float(1), params.w));
    return vec3(xy, viewDepth.negate());
  };

  const viewPositionOf = (pixel: TslNode) => {
    const clamped = clampPixel(pixel);
    return viewPositionAt(clamped, sampleViewDepth(clamped));
  };

  const fastAcos = (value: TslNode) => {
    const absolute = abs(value);
    const result = absolute.mul(-0.156583).add(HALF_PI).mul(sqrt(float(1).sub(absolute)));
    return value.greaterThanEqual(0).select(result, float(PI).sub(result));
  };

  const closerDifference = (forward: TslNode, backward: TslNode, atStart: TslNode,
    atEnd: TslNode) => {
    const closer = abs(forward.z).lessThan(abs(backward.z)).select(forward, backward);
    return atStart.select(forward, atEnd.select(backward, closer));
  };

  /** The view normal from the neighbour closer in depth on each axis (no smearing over edges). */
  const normalAt = (pixel: TslNode, centre: TslNode) => {
    const right = viewPositionOf(pixel.add(vec2(1, 0))).sub(centre);
    const left = centre.sub(viewPositionOf(pixel.sub(vec2(1, 0))));
    const up = viewPositionOf(pixel.add(vec2(0, 1))).sub(centre);
    const down = centre.sub(viewPositionOf(pixel.sub(vec2(0, 1))));
    const last = halfSize.sub(1);
    const alongX = closerDifference(right, left, pixel.x.lessThanEqual(0),
      pixel.x.greaterThanEqual(last.x));
    const alongY = closerDifference(up, down, pixel.y.lessThanEqual(0),
      pixel.y.greaterThanEqual(last.y));
    return normalize(cross(alongX, alongY));
  };

  const horizonCos = (pixel: TslNode, centre: TslNode, normal: TslNode, viewVector: TslNode,
    lowCos: TslNode, falloff: TslNode) => {
    const inside = pixel.x.greaterThanEqual(0).and(pixel.y.greaterThanEqual(0))
      .and(pixel.x.lessThan(halfSize.x)).and(pixel.y.lessThan(halfSize.y));
    const clamped = clampPixel(pixel);
    const delta = viewPositionAt(clamped, sampleViewDepth(clamped)).sub(centre);
    const separation = max(length(delta), 1e-4);
    const weight = clamp(separation.mul(falloff.x).add(falloff.y), 0, 1)
      .mul(smoothstep(shape.y, shape.y.mul(2), delta.dot(normal)));
    const computed = mix(lowCos, delta.div(separation).dot(viewVector), weight);
    return inside.select(computed, lowCos);
  };

  const sliceVisibility = (phi: TslNode, pixel: TslNode, centre: TslNode, normal: TslNode,
    viewVector: TslNode, radiusTexels: TslNode, stepNoise: TslNode, falloff: TslNode) => {
    const omega = vec2(cos(phi), sin(phi));
    const direction = vec3(omega, 0);
    const orthoDirection = direction.sub(viewVector.mul(direction.dot(viewVector)));
    const axisDirection = normalize(cross(orthoDirection, viewVector));
    const projectedNormal = normal.sub(axisDirection.mul(normal.dot(axisDirection)));
    const projectedLength = length(projectedNormal);
    const cosNormal = clamp(projectedNormal.dot(viewVector).div(max(projectedLength, 1e-4)), 0, 1);
    const angle = sign(orthoDirection.dot(projectedNormal)).mul(fastAcos(cosNormal));
    let forward: TslNode = cos(angle.add(HALF_PI));
    let backward: TslNode = cos(angle.sub(HALF_PI));
    for (let sampleIndex = 0; sampleIndex < AO_GTAO_STEPS; sampleIndex += 1) {
      const t = float(sampleIndex).add(stepNoise).div(AO_GTAO_STEPS);
      const offset = omega.mul(max(t.mul(t).mul(radiusTexels), sampleIndex + 1));
      const shift = vec2(round(offset.x), round(offset.y));
      forward = max(forward, horizonCos(pixel.add(shift), centre, normal, viewVector,
        cos(angle.add(HALF_PI)), falloff));
      backward = max(backward, horizonCos(pixel.sub(shift), centre, normal, viewVector,
        cos(angle.sub(HALF_PI)), falloff));
    }
    const h0 = angle.add(clamp(fastAcos(backward).negate().sub(angle), -HALF_PI, HALF_PI));
    const h1 = angle.add(clamp(fastAcos(forward).sub(angle), -HALF_PI, HALF_PI));
    const arc0 = cosNormal.add(float(2).mul(h0).mul(sin(angle))).sub(cos(h0.mul(2).sub(angle)));
    const arc1 = cosNormal.add(float(2).mul(h1).mul(sin(angle))).sub(cos(h1.mul(2).sub(angle)));
    return projectedLength.mul(arc0.add(arc1)).mul(0.25);
  };

  const depthPass = createPassMaterial("tsl:ao-depth", (() => {
    const pixel = floor(uv().mul(halfSize));
    const depth = sampleDepth(pixel.mul(2));
    return vec4(depth.greaterThanEqual(1).select(float(AO_SKY_VIEW_DEPTH), viewDepthOf(depth)), 0, 0, 1);
  })());

  const gtaoPass = createPassMaterial("tsl:ao-gtao", (() => {
    const pixel = floor(uv().mul(halfSize));
    const viewDepth = sampleViewDepth(pixel);
    const radiusTexels = float(0.5).mul(params.x).mul(params.y)
      .div(mix(viewDepth, float(1), params.w));
    const limited = min(radiusTexels, float(0.5).mul(params.z));
    const centre = viewPositionAt(pixel, viewDepth);
    const normal = normalAt(pixel, centre);
    const viewVector = mix(normalize(centre.negate()), vec3(0, 0, 1), params.w);
    const tile = vec2(pixel.x.mod(4), pixel.y.mod(4));
    const sliceNoise = textureLoad(bayerNode, texel(tile)).r.div(16) as TslNode;
    const stepNoise = textureLoad(bayerNode,
      texel(vec2(tile.x.add(1).mod(4), tile.y.add(2).mod(4)))).r.add(0.5).div(16) as TslNode;
    const range = shape.x.mul(params.x);
    const falloff = vec2(float(-1).div(range), params.x.mul(float(1).sub(shape.x)).div(range).add(1));
    let visibility: TslNode = float(0);
    for (let slice = 0; slice < AO_GTAO_SLICES; slice += 1) {
      const phi = float(slice).add(sliceNoise).mul(PI).div(AO_GTAO_SLICES);
      visibility = visibility.add(
        sliceVisibility(phi, pixel, centre, normal, viewVector, limited, stepNoise, falloff));
    }
    const value = clamp(visibility.div(AO_GTAO_SLICES), 0, 1);
    const sky = viewDepth.greaterThanEqual(AO_SKY_VIEW_DEPTH).or(radiusTexels.lessThan(1));
    return sky.select(vec4(1, viewDepth, 0, 1), vec4(value, viewDepth, 0, 1));
  })());

  const blurPass = createPassMaterial("tsl:ao-blur", (() => {
    const pixel = floor(uv().mul(halfSize));
    const centre = textureLoad(blurSourceNode, texel(pixel)).rgb as TslNode;
    const depthTolerance = tolerance.x.add(centre.g.mul(tolerance.y));
    let sum: TslNode = vec2(0);
    let weight: TslNode = float(0);
    for (let offset = -AO_BLUR_RADIUS; offset <= AO_BLUR_RADIUS; offset += 1) {
      const position = clampPixel(pixel.add(axis.mul(offset)));
      const tap = textureLoad(blurSourceNode, texel(position)).rgb as TslNode;
      const tent = Math.abs(offset) === AO_BLUR_RADIUS
        ? AO_BLUR_TENT_WEIGHTS[0] : AO_BLUR_TENT_WEIGHTS[1];
      const similar = max(0, float(1).sub(abs(tap.g.sub(centre.g)).div(depthTolerance)));
      sum = sum.add(tap.rb.mul(tent).mul(similar));
      weight = weight.add(similar.mul(tent));
    }
    const support = clamp(weight.sub(1).div(1.5), 0, 1);
    const blurred = sum.div(max(weight, 1e-4));
    return vec4(mix(1, blurred.x, support), centre.g, blurred.y, 1);
  })());

  return {
    dispose: () => {
      for (const target of [viewDepthTarget, occlusionTarget, blurredTarget]) target.dispose();
      for (const material of [depthPass, gtaoPass, blurPass]) material.dispose();
      bayerTexture.dispose();
    },
    resize: (width, height) => {
      const [halfWidth, halfHeight] = ambientOcclusionSize(width, height);
      resizePostTarget(viewDepthTarget, halfWidth, halfHeight);
      resizePostTarget(occlusionTarget, halfWidth, halfHeight);
      resizePostTarget(blurredTarget, halfWidth, halfHeight);
      halfSize.value.set(halfWidth, halfHeight);
      fullSize.value.set(width, height);
    },
    render: (camera, width, height) => {
      const projection = camera.projectionMatrix.elements;
      const inverse = camera.projectionMatrixInverse.elements;
      const orthographic = isOrthographic(camera) ? 1 : 0;
      const projectionScale = projection[5]! * fullSize.value.y * 0.5;
      const offsetX = orthographic ? projection[12]! : -projection[8]!;
      const offsetY = orthographic ? projection[13]! : -projection[9]!;
      unproject.value.set(1 / projection[0]!, 1 / projection[5]!, offsetX, offsetY);
      params.value.set(tuning.radius, projectionScale, tuning.maxRadiusPixels, orthographic);
      tolerance.value.set(tuning.depthTolerance.absolute,
        tuning.depthTolerance.relative * (1 - orthographic));
      depthToView.value.set(inverse[10]!, inverse[14]!, inverse[11]!, inverse[15]!);
      quad.draw(depthPass, viewDepthTarget);
      quad.draw(gtaoPass, occlusionTarget);
      blurSourceNode.value = occlusionTarget.texture;
      axis.value.set(1, 0);
      quad.draw(blurPass, blurredTarget);
      blurSourceNode.value = blurredTarget.texture;
      axis.value.set(0, 1);
      quad.draw(blurPass, occlusionTarget);
      occlusionNode.value = occlusionTarget.texture;
      fullSize.value.set(width, height);
    },
    texture: () => occlusionTarget.texture,
    visibility: (pixel, mask) => {
      const depth = sampleDepth(pixel);
      const viewDepth = viewDepthOf(depth);
      const depthTolerance = tolerance.x.add(viewDepth.mul(tolerance.y));
      const position = pixel.mul(0.5);
      const base = floor(position);
      const fraction = position.sub(base);
      let sum: TslNode = vec2(0);
      let weight: TslNode = float(0);
      for (let index = 0; index < 4; index += 1) {
        const offset = vec2(index & 1, index >> 1);
        const tap = textureLoad(occlusionNode, texel(base.add(offset))).rgb as TslNode;
        const share = mix(float(1).sub(fraction), fraction, offset);
        const gap = abs(tap.g.sub(viewDepth));
        const tapWeight = share.x.mul(share.y).mul(max(0, float(1).sub(gap.div(depthTolerance))));
        sum = sum.add(tap.rb.mul(tapWeight));
        weight = weight.add(tapWeight);
      }
      const upsampled = sum.div(max(weight, 1e-4));
      const visibility = mix(1, upsampled.x, clamp(weight.mul(8), 0, 1));
      const occluded = mix(pow(visibility, tuning.power), 1, upsampled.y.mul(tuning.sunlit));
      const valid = depth.lessThan(1).and(mask.greaterThan(0));
      return valid.select(mix(1, occluded, float(tuning.strength).mul(mask)), 1);
    }
  };
};
