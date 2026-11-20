import { dot, float, Fn, log2, max, mix, texture, uniform, uv, vec2, vec3, vec4 } from "three/tsl";
import { FloatType, NearestFilter, RedFormat, type Texture, Vector2, Vector3 } from "three/webgpu";

import {
  adaptationRate,
  type EyeAdaptationLimits,
  type EyeAdaptationTuning
} from "../../../../render-common/eye-adaptation";
import { LUMA_REC709 } from "../../../../render-common/luma";
import {
  EXPOSURE_GRID,
  EXPOSURE_MIN_LUMINANCE,
  EXPOSURE_REDUCE_BLOCK,
  EXPOSURE_TAPS_PER_AXIS
} from "../../../../render-common/shaders/frame-exposure-glsl";
import { colorSceneToRadiance } from "../color-output";
import type { PostColourNodes } from "./colour-nodes";
import { createPassMaterial, type QuadPass } from "./quad-pass";
import { createPostTarget } from "./targets";

/** This frame's adaptation inputs; the eye control (frame-eye-adaptation.ts) computes them. */
export interface TslExposureStep {
  dtSeconds: number;
  limits: EyeAdaptationLimits;
  reset: boolean;
}

export interface TslExposureOptions {
  colour: PostColourNodes;
  quad: QuadPass;
  sceneTexture: Texture;
  tuning: EyeAdaptationTuning;
}

export interface TslExposure {
  dispose: () => void;
  /** Measures the scene, adapts, and updates the 1 x 1 texture whose red channel holds the EV. */
  render: (step: TslExposureStep) => Texture;
  resize: (width: number, height: number) => void;
}

const lumaNode = vec3(...LUMA_REC709);
const GRID = vec2(EXPOSURE_GRID.width, EXPOSURE_GRID.height);
const REDUCE = vec2(EXPOSURE_REDUCE_BLOCK.width, EXPOSURE_REDUCE_BLOCK.height);
const REDUCED_WIDTH = EXPOSURE_GRID.width / EXPOSURE_REDUCE_BLOCK.width;
const REDUCED_HEIGHT = EXPOSURE_GRID.height / EXPOSURE_REDUCE_BLOCK.height;

/** The reduction pass reads every texel of one block; both strides divide the grid exactly. */
const createReduceNode = (initialTexture: Texture) => {
  const sourceSize = uniform(new Vector2(1, 1));
  const sourceNode = texture(initialTexture);
  const fragment = Fn(() => {
    const base = uv().mul(sourceSize).div(REDUCE).floor().mul(REDUCE);
    const sum = float(0).toVar();
    for (let y = 0; y < EXPOSURE_REDUCE_BLOCK.height; y += 1) {
      for (let x = 0; x < EXPOSURE_REDUCE_BLOCK.width; x += 1) {
        const pixel = base.add(vec2(x, y)).add(0.5);
        sum.addAssign(sourceNode.sample(pixel.div(sourceSize)).r);
      }
    }
    return vec4(sum.div(EXPOSURE_REDUCE_BLOCK.width * EXPOSURE_REDUCE_BLOCK.height), 0, 0, 1);
  })();
  return { fragment, sourceNode, sourceSize };
};

/**
 * TSL port of the R11c possessed auto-exposure (frame-exposure.ts): a 64 x 36 log-luminance grid,
 * two exact 8 x 6 block reductions to one texel, and the adaptation step into a 1 x 1 ping-pong
 * target. The scene is measured before any exposure applies, so the loop stays open.
 */
export const createTslExposure = (options: TslExposureOptions): TslExposure => {
  const { colour, quad, sceneTexture, tuning } = options;
  const grid = createPostTarget(EXPOSURE_GRID.width, EXPOSURE_GRID.height,
    { filter: NearestFilter, format: RedFormat, type: FloatType });
  const reduced = createPostTarget(REDUCED_WIDTH, REDUCED_HEIGHT,
    { filter: NearestFilter, format: RedFormat, type: FloatType });
  const mean = createPostTarget(1, 1, { filter: NearestFilter, format: RedFormat, type: FloatType });
  const adapted = [createPostTarget(1, 1, { filter: NearestFilter, format: RedFormat, type: FloatType }),
    createPostTarget(1, 1, { filter: NearestFilter, format: RedFormat, type: FloatType })] as const;
  let current = 0;

  const sceneNode = texture(sceneTexture);
  const sceneSize = uniform(new Vector2(1, 1));
  const luminance = createPassMaterial("tsl:exposure-luminance", Fn(() => {
    const cell = sceneSize.div(GRID);
    const origin = uv().mul(GRID).floor().mul(cell);
    const tapStep = cell.div(EXPOSURE_TAPS_PER_AXIS);
    const sum = float(0).toVar();
    for (let y = 0; y < EXPOSURE_TAPS_PER_AXIS; y += 1) {
      for (let x = 0; x < EXPOSURE_TAPS_PER_AXIS; x += 1) {
        const at = origin.add(vec2(x, y).add(0.5).mul(tapStep))
          .min(sceneSize.sub(1)).add(0.5);
        const linear = colorSceneToRadiance(sceneNode.sample(at.div(sceneSize)).rgb,
          colour.exposure, colour.toneWeight, colour.rain, colour.vivid);
        sum.addAssign(log2(max(dot(linear, lumaNode), EXPOSURE_MIN_LUMINANCE)));
      }
    }
    return vec4(sum.div(EXPOSURE_TAPS_PER_AXIS * EXPOSURE_TAPS_PER_AXIS), 0, 0, 1);
  })());

  const reduce = createReduceNode(sceneTexture);
  const reduceMaterial = createPassMaterial("tsl:exposure-reduce", reduce.fragment);

  const meanNode = texture(mean.texture);
  const previousNode = texture(adapted[0]!.texture);
  const target = uniform(new Vector3(0, 0, 0));
  const compensation = uniform(new Vector2(1, 1));
  const rates = uniform(new Vector2(1, 1));
  const adapt = createPassMaterial("tsl:exposure-adapt", Fn(() => {
    const sample = meanNode.sample(vec2(0.5)).r;
    const meanValue = sample.equal(sample).select(sample, target.z);
    const difference = target.z.sub(meanValue);
    const share = difference.greaterThan(0).select(compensation.x, compensation.y);
    const wanted = difference.mul(share).clamp(target.x, target.y);
    const previous = previousNode.sample(vec2(0.5)).r;
    const previousValue = previous.equal(previous).select(previous, wanted);
    const rate = wanted.greaterThan(previousValue).select(rates.x, rates.y);
    return vec4(mix(previousValue, wanted, rate), 0, 0, 1);
  })());

  const reduceInto = (source: typeof grid, destination: typeof grid) => {
    reduce.sourceNode.value = source.texture;
    reduce.sourceSize.value.set(source.width, source.height);
    quad.draw(reduceMaterial, destination);
  };

  return {
    dispose: () => {
      for (const target of [grid, reduced, mean, ...adapted]) target.dispose();
      for (const material of [luminance, reduceMaterial, adapt]) material.dispose();
    },
    render: step => {
      target.value.set(step.limits.minEv, step.limits.maxEv, step.limits.keyLog2);
      compensation.value.set(tuning.brightenCompensation, tuning.darkenCompensation);
      rates.value.set(
        step.reset ? 1 : adaptationRate(step.dtSeconds, tuning.brightenSeconds),
        step.reset ? 1 : adaptationRate(step.dtSeconds, tuning.darkenSeconds));
      quad.draw(luminance, grid);
      reduceInto(grid, reduced);
      reduceInto(reduced, mean);
      const previous = adapted[current]!;
      current = 1 - current;
      previousNode.value = previous.texture;
      quad.draw(adapt, adapted[current]!);
      return adapted[current]!.texture;
    },
    resize: (width, height) => sceneSize.value.set(width, height)
  };
};
