import { dot, float, Fn, mix, smoothstep, texture, uniform, uv, vec2, vec3, vec4 } from "three/tsl";
import { type Texture, Vector2, Vector3 } from "three/webgpu";

import type { BloomFrameValues, BloomRuntimeTuning } from "../../../../render-common/bloom-phases";
import { LUMA_REC709 } from "../../../../render-common/luma";
import { bloomMipSize } from "../../../../render-common/post-sizes";
import {
  BLOOM_CLIPPED_DISPLAY,
  BLOOM_TAP_OFFSETS,
  BLOOM_TENT_DIVISOR,
  BLOOM_TENT_WEIGHTS,
  BLOOM_TUNING
} from "../../../../render-common/shaders/frame-bloom-glsl";
import { colorGradeInverse, colorSrgbDecode, colorSrgbEncode, colorToneMapInverse } from "../color-output";
import type { PostColourNodes } from "./colour-nodes";
import { createPassMaterial, type QuadPass } from "./quad-pass";
import { createPostTarget, resizePostTarget } from "./targets";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

export interface TslBloomOptions {
  colour: PostColourNodes;
  /** Mip levels of the chain: 3 for "low", 5 for "on". */
  mips: number;
  quad: QuadPass;
  /** The resolved scene colour (decoded display) the prefilter reads. */
  sceneTexture: Texture;
  tuning: BloomRuntimeTuning;
}

export interface TslBloom {
  dispose: () => void;
  /** Mip levels of the chain (the number of half-float targets it owns). */
  readonly levels: number;
  /** Builds the chain from this frame's phase-blended values; returns the summed bloom texture. */
  render: (frame: BloomFrameValues) => Texture;
  resize: (width: number, height: number) => void;
}

const lumaNode = vec3(...LUMA_REC709);
const WHITE_LUMA = BLOOM_TUNING.clipWhiteLuma;

/**
 * TSL twin of the R11b bloom chain (frame-bloom.ts). The prefilter selects display-bright texels
 * and recovers their linear radiance, the 13-tap downsamples spread the halo (Karis weights on the
 * first level), and the 9-tap tents add the coarse levels back on. The values are the
 * phase-blended BLOOM_TUNING ones, so day, golden hour and night match WebGL.
 */
export const createTslBloom = (options: TslBloomOptions): TslBloom => {
  const { colour, mips, quad, sceneTexture, tuning } = options;
  const targets = Array.from({ length: mips }, () => createPostTarget(1, 1));
  const sceneSize = uniform(new Vector2(1, 1));
  const sourceSize = uniform(new Vector2(1, 1));
  const sourceNode = texture(sceneTexture);
  const threshold = uniform(1);
  const knee = uniform(0);
  const clipWhiteOnly = uniform(0);
  const clippedBoost = uniform(0);
  const tint = uniform(new Vector3(1, 1, 1));
  const karisLuma = uniform(tuning.karisLuma);
  const radius = uniform(1);
  const upsampleWeight = uniform(1);
  const uvNode = uv();

  /** Clipped-sun weight of a stored display texel (the GLSL bloomClipped). */
  const bloomClipped = (stored: TslNode) => {
    const clipped = smoothstep(
      BLOOM_CLIPPED_DISPLAY.min, BLOOM_CLIPPED_DISPLAY.max,
      stored.r.max(stored.g).max(stored.b));
    const white = smoothstep(WHITE_LUMA[0], WHITE_LUMA[1], dot(stored, lumaNode));
    return clipped.mul(mix(1, white, clipWhiteOnly));
  };

  /** One scene texel as selected linear radiance (the GLSL bloomSource). */
  const bloomSource = (sample: TslNode) => {
    const stored = colorSrgbEncode(sample);
    const display = colorGradeInverse(stored, colour.rain, colour.vivid, colour.toneWeight);
    const brightness = display.r.max(display.g).max(display.b);
    const selected = smoothstep(threshold, threshold.add(knee), brightness);
    const radiance = colorToneMapInverse(colorSrgbDecode(display.clamp(0, 1)),
      colour.exposure, colour.toneWeight);
    const clipped = float(1).add(clippedBoost.mul(bloomClipped(stored)));
    return radiance.max(0).min(BLOOM_TUNING.maxRadiance).mul(selected.mul(clipped));
  };

  const prefilter = createPassMaterial("tsl:bloom-prefilter", Fn(() => {
    const texel = vec2(1).div(sceneSize);
    const sum = vec3(0).toVar();
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < 2; x += 1) {
        const offset = vec2(x - 0.5, y - 0.5).mul(texel);
        sum.addAssign(bloomSource(sourceNode.sample(uvNode.add(offset)).rgb));
      }
    }
    return vec4(sum.mul(0.25).mul(tint), 1);
  })());

  const sampleTap = (offset: readonly [number, number]) =>
    sourceNode.sample(uvNode.add(vec2(offset[0], offset[1]).mul(vec2(1).div(sourceSize)))).rgb;

  const downsampleKaris = createPassMaterial("tsl:bloom-downsample-karis", Fn(() => {
    const sum = vec3(0).toVar();
    const total = float(0).toVar();
    for (const offset of BLOOM_TAP_OFFSETS) {
      const tap = sampleTap(offset);
      const tapWeight = float(1).div(float(1).add(dot(tap, lumaNode).div(karisLuma)));
      sum.addAssign(tap.mul(tapWeight));
      total.addAssign(tapWeight);
    }
    return vec4(sum.div(total.max(1e-5)), 1);
  })());

  const downsample = createPassMaterial("tsl:bloom-downsample", Fn(() => {
    const sum = vec3(0).toVar();
    for (const offset of BLOOM_TAP_OFFSETS) sum.addAssign(sampleTap(offset));
    return vec4(sum.div(BLOOM_TAP_OFFSETS.length), 1);
  })());

  const upsample = createPassMaterial("tsl:bloom-upsample", Fn(() => {
    const texel = vec2(radius, radius).div(sourceSize);
    const sample = (dx: number, dy: number) =>
      sourceNode.sample(uvNode.add(vec2(dx, dy).mul(texel))).rgb;
    const sum = sample(0, 0).mul(BLOOM_TENT_WEIGHTS[0])
      .add(sample(-1, 0).mul(BLOOM_TENT_WEIGHTS[1]))
      .add(sample(1, 0).mul(BLOOM_TENT_WEIGHTS[2]))
      .add(sample(0, -1).mul(BLOOM_TENT_WEIGHTS[3]))
      .add(sample(0, 1).mul(BLOOM_TENT_WEIGHTS[4]))
      .add(sample(-1, -1)).add(sample(1, -1))
      .add(sample(-1, 1)).add(sample(1, 1));
    return vec4(sum.mul(upsampleWeight.div(BLOOM_TENT_DIVISOR)), 1);
  })(), { additive: true });

  const drawDownsample = (level: number, karis: boolean) => {
    const source = targets[level - 1]!;
    sourceNode.value = source.texture;
    sourceSize.value.set(source.width, source.height);
    quad.draw(karis ? downsampleKaris : downsample, targets[level]!);
  };

  const render = (frame: BloomFrameValues) => {
    threshold.value = frame.threshold;
    knee.value = frame.knee;
    clipWhiteOnly.value = frame.clipWhiteOnly;
    clippedBoost.value = frame.clippedBoost;
    tint.value.fromArray(frame.tint);
    sourceNode.value = sceneTexture;
    sourceSize.value.set(sceneSize.value.x, sceneSize.value.y);
    quad.draw(prefilter, targets[0]!);
    for (let level = 1; level < mips; level += 1) drawDownsample(level, level === 1);
    for (let level = mips - 1; level > 0; level -= 1) {
      const source = targets[level]!;
      sourceNode.value = source.texture;
      sourceSize.value.set(source.width, source.height);
      radius.value = (tuning.upsampleRadii[level] ?? 1) * frame.radiusScale;
      upsampleWeight.value = tuning.upsampleWeights[level] ?? 1;
      quad.draw(upsample, targets[level - 1]!);
    }
    return targets[0]!.texture;
  };

  const resize = (width: number, height: number) => {
    sceneSize.value.set(width, height);
    targets.forEach((target, level) => {
      const [mipWidth, mipHeight] = bloomMipSize(width, height, level);
      resizePostTarget(target, mipWidth, mipHeight);
    });
  };

  return {
    dispose: () => {
      for (const target of targets) target.dispose();
      for (const material of [prefilter, downsampleKaris, downsample, upsample]) material.dispose();
    },
    levels: mips,
    render,
    resize
  };
};
