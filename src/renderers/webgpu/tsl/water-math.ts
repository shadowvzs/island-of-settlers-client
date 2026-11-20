import { clamp, cos, dot, float, length, mix, sin, smoothstep, vec2, vec3 } from "three/tsl";

import { FOAM_GLARE_FLOOR } from "../../../render-common/highlights";
import { SURF_TIMING, WATER_WAVE_TRAINS } from "../../../render-common/shaders/water-glsl";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

const TWO_PI = 6.2831853;

export interface WaterMathOptions {
  highlight: TslNode;
  time: TslNode;
}

/**
 * Pure wave, surf and colour math shared by the water material and the GPU parity bench. The GLSL
 * twin lives in `water-glsl.ts` (WATER_SWELL_GLSL, the surf helpers and waterFresnel); every
 * function here is a direct port, so the parity cases in `tools/bench` can compare them.
 */
export const createWaterMathNodes = ({ highlight, time }: WaterMathOptions) => {
  const swellWave = (settings: TslNode, amplitude: number, speed: number, point: TslNode): TslNode => {
    const phase = settings.z.mul(dot(settings.xy, point)).add(time.mul(speed)) as TslNode;
    return vec3(sin(phase), settings.xy.mul(settings.z).mul(cos(phase))).mul(amplitude) as TslNode;
  };

  const settingsOf = (train: (typeof WATER_WAVE_TRAINS)[number]): TslNode =>
    vec3(train.direction[0], train.direction[1], train.frequency) as TslNode;

  /** x: swell height, yz: its slope (WATER_SWELL_GLSL `getSwell`). */
  const swell = (point: TslNode): TslNode => swellWave(settingsOf(WATER_WAVE_TRAINS[0]),
    WATER_WAVE_TRAINS[0].amplitude, WATER_WAVE_TRAINS[0].speed, point)
    .add(swellWave(settingsOf(WATER_WAVE_TRAINS[1]), WATER_WAVE_TRAINS[1].amplitude,
      WATER_WAVE_TRAINS[1].speed, point))
    .add(swellWave(settingsOf(WATER_WAVE_TRAINS[2]), WATER_WAVE_TRAINS[2].amplitude,
      WATER_WAVE_TRAINS[2].speed, point)) as TslNode;

  const swellCalm = (depth: TslNode, flow: TslNode): TslNode =>
    smoothstep(0.4, 2.5, depth)
      .mul(float(1).sub(smoothstep(0.01, 0.2, length(flow)))) as TslNode;

  const swellSlopeWeight = (depth: TslNode, flow: TslNode): TslNode =>
    mix(0.35, 1, smoothstep(0.4, 2.5, depth))
      .mul(float(1).sub(smoothstep(0.01, 0.2, length(flow)))) as TslNode;

  const waterShadowFloor = (depth: TslNode): TslNode =>
    mix(0.55, 0.75, smoothstep(0.3, 2.5, depth)) as TslNode;

  const waterFresnel = (cosTheta: TslNode): TslNode => {
    const facing = float(1).sub(clamp(cosTheta, 0, 1)) as TslNode;
    const facing2 = facing.mul(facing) as TslNode;
    return float(0.0204).add(float(0.9796).mul(facing2).mul(facing2).mul(facing)) as TslNode;
  };

  const foamGlare = (): TslNode => mix(FOAM_GLARE_FLOOR, 1, highlight) as TslNode;

  const surfPhase = (xz: TslNode, coast: TslNode): TslNode => {
    const warp = sin(dot(xz, vec2(0.23, 0.11)))
      .add(sin(dot(xz, vec2(-0.09, 0.31)).add(1.7)).mul(0.6)) as TslNode;
    return coast.mul(SURF_TIMING.waveNumber).sub(time.mul(SURF_TIMING.speed))
      .add(warp.mul(1.4)) as TslNode;
  };
  const surfAge = (xz: TslNode, coast: TslNode): TslNode =>
    float(1).sub(float(surfPhase(xz, coast).div(TWO_PI)).fract()) as TslNode;
  const surfFreshness = (age: TslNode): TslNode =>
    float(1).sub(age).mul(smoothstep(0, 0.06, age)) as TslNode;
  const surfSections = (xz: TslNode): TslNode => {
    const along = sin(dot(xz, vec2(0.29, -0.21)).add(time.mul(0.23))) as TslNode;
    const across = sin(dot(xz, vec2(-0.17, -0.33)).mul(1.3).add(2.1).sub(time.mul(0.17))) as TslNode;
    return smoothstep(-0.25, 0.75, along.mul(0.6).add(across.mul(0.4))) as TslNode;
  };

  return {
    foamGlare,
    surfAge,
    surfFreshness,
    surfSections,
    swell,
    swellCalm,
    swellSlopeWeight,
    swellWave,
    waterFresnel,
    waterShadowFloor
  };
};

export type WaterMathNodes = ReturnType<typeof createWaterMathNodes>;
