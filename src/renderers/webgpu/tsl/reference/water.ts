import { FOAM_GLARE_FLOOR } from "../../../../render-common/highlights";
import { SURF_TIMING, WATER_WAVE_TRAINS } from "../../../../render-common/shaders/water-glsl";

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

const TWO_PI = 2 * Math.PI;

const swellWave = (settings: Vec3, amplitude: number, speed: number, point: Vec2, time: number): Vec3 => {
  const phase = settings[2] * (settings[0] * point[0] + settings[1] * point[1]) + time * speed;
  const cosine = Math.cos(phase);
  return [Math.sin(phase) * amplitude, settings[0] * settings[2] * cosine * amplitude,
    settings[1] * settings[2] * cosine * amplitude];
};

/** CPU reference of WATER_SWELL_GLSL `getSwell`. */
export const getSwell = (point: Vec2, time: number): Vec3 => {
  const [a, b, c] = WATER_WAVE_TRAINS;
  const settings = (train: (typeof WATER_WAVE_TRAINS)[number]): Vec3 =>
    [train.direction[0], train.direction[1], train.frequency];
  const sum = swellWave(settings(a), a.amplitude, a.speed, point, time);
  const second = swellWave(settings(b), b.amplitude, b.speed, point, time);
  const third = swellWave(settings(c), c.amplitude, c.speed, point, time);
  return [sum[0] + second[0] + third[0], sum[1] + second[1] + third[1], sum[2] + second[2] + third[2]];
};

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
};

export const getSwellCalm = (depth: number, flow: Vec2): number =>
  smoothstep(0.4, 2.5, depth) * (1 - smoothstep(0.01, 0.2, Math.hypot(flow[0], flow[1])));

export const getSwellSlopeWeight = (depth: number, flow: Vec2): number =>
  (0.35 + (1 - 0.35) * smoothstep(0.4, 2.5, depth))
  * (1 - smoothstep(0.01, 0.2, Math.hypot(flow[0], flow[1])));

export const waterShadowFloor = (depth: number): number =>
  0.55 + (0.75 - 0.55) * smoothstep(0.3, 2.5, depth);

export const waterFresnel = (cosTheta: number): number => {
  const facing = 1 - Math.min(Math.max(cosTheta, 0), 1);
  const facing2 = facing * facing;
  return 0.0204 + 0.9796 * facing2 * facing2 * facing;
};

export const foamGlare = (highlight: number): number =>
  FOAM_GLARE_FLOOR + (1 - FOAM_GLARE_FLOOR) * highlight;

const fract = (value: number) => value - Math.floor(value);

export const surfPhase = (xz: Vec2, coast: number, time: number): number => {
  const warp = Math.sin(xz[0] * 0.23 + xz[1] * 0.11)
    + Math.sin(xz[0] * -0.09 + xz[1] * 0.31 + 1.7) * 0.6;
  return coast * SURF_TIMING.waveNumber - time * SURF_TIMING.speed + warp * 1.4;
};

export const surfAge = (xz: Vec2, coast: number, time: number): number =>
  1 - fract(surfPhase(xz, coast, time) / TWO_PI);

export const surfFreshness = (age: number): number => (1 - age) * smoothstep(0, 0.06, age);

export const surfSections = (xz: Vec2, time: number): number => {
  const along = Math.sin(xz[0] * 0.29 + xz[1] * -0.21 + time * 0.23);
  const across = Math.sin((xz[0] * -0.17 + xz[1] * -0.33) * 1.3 + 2.1 - time * 0.17);
  return smoothstep(-0.25, 0.75, along * 0.6 + across * 0.4);
};
