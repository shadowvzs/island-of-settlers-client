import {
  FOG_CLEAR_VISIBILITY,
  getFogVisibilityFade
} from "../../../../render-common/atmosphere/fog-visibility";
import { FAR_SEA_HAZE, FOG_COVER, MAP_EDGE_CELLS } from "../../../../render-common/shaders/common-glsl";
import { fbm2Octaves, fbm3 } from "./noise";

/** CPU reference of the fog functions in `common-glsl.ts`; the TSL module mirrors these. */
export type Rgb = readonly [number, number, number];
export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];


const mix = (a: Rgb, b: Rgb, weight: number): Rgb => [
  a[0] + (b[0] - a[0]) * weight,
  a[1] + (b[1] - a[1]) * weight,
  a[2] + (b[2] - a[2]) * weight
];
const map3 = (a: Vec3, operation: (component: number, index: number) => number): Vec3 =>
  [operation(a[0], 0), operation(a[1], 1), operation(a[2], 2)];
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize3 = (a: Vec3): Vec3 => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export const fogVisibilityFade = (visibility: number) => getFogVisibilityFade(visibility);

export const fogCoverPuffs = (xz: Vec2, time: number) =>
  fbm3(xz[0] * 0.05 - time * 0.025, xz[1] * 0.05);

export const fogCoverRelief = (xz: Vec2, time: number) =>
  fbm2Octaves(xz[0] * 0.05 - time * 0.025, xz[1] * 0.05) / 0.8;

export const fogCoverColor = (puffs: number, fogColor: Rgb): Rgb =>
  mix([fogColor[0] * 0.62, fogColor[1] * 0.62, fogColor[2] * 0.62],
    [fogColor[0] * 1.12, fogColor[1] * 1.12, fogColor[2] * 1.12],
    smoothstep(0.25, 0.8, puffs));

export const litFogCover = (puffs: number, xz: Vec2, time: number, viewDirection: Vec3,
  sunDirection: Vec3, sunColor: Rgb, rain: number, fogColor: Rgb): Rgb => {
  const toEye = normalize3(viewDirection);
  const top: Vec2 = [xz[0] + toEye[0] / Math.max(toEye[1], 0.35) * FOG_COVER.relief * puffs,
    xz[1] + toEye[2] / Math.max(toEye[1], 0.35) * FOG_COVER.relief * puffs];
  const relief = fogCoverRelief(top, time);
  const east = fogCoverRelief([top[0] + FOG_COVER.step, top[1]], time);
  const south = fogCoverRelief([top[0], top[1] + FOG_COVER.step], time);
  const normal = normalize3([(relief - east) * FOG_COVER.slope, 1,
    (relief - south) * FOG_COVER.slope]);
  const light = normalize3(sunDirection);
  const lightX = light[0] + 1e-4, lightZ = light[2] + 1e-4;
  const lightLength = Math.hypot(lightX, lightZ) || 1;
  const towardLight = fogCoverRelief([
    top[0] + lightX / lightLength * FOG_COVER.shadowStep,
    top[1] + lightZ / lightLength * FOG_COVER.shadowStep
  ], time);
  const shadow = 1 - 0.3 * smoothstep(0.02, 0.12, towardLight - relief);
  const diffuse = Math.min(1, Math.max(0, (dot3(normal, light) + 0.4) / 1.4)) * shadow;
  const hollow = 0.92 + (1.06 - 0.92) * smoothstep(0.3, 0.75, relief);
  const lightHue: Rgb = [
    sunColor[0] / Math.max(Math.max(sunColor[0], sunColor[1], sunColor[2]), 0.05),
    sunColor[1] / Math.max(Math.max(sunColor[0], sunColor[1], sunColor[2]), 0.05),
    sunColor[2] / Math.max(Math.max(sunColor[0], sunColor[1], sunColor[2]), 0.05)
  ];
  const sunlit = map3(lightHue, component =>
    FOG_COVER.sun * (1 + (component - 1) * FOG_COVER.tint));
  const level = map3(sunlit, component =>
    FOG_COVER.ambient + component * Math.min(1, Math.max(0, (light[1] + 0.4) / 1.4)));
  const shade = map3(sunlit, (component, index) =>
    FOG_COVER.gain * (FOG_COVER.ambient + component * diffuse) / level[index]!);
  const tint = 1 - 0.6 * rain;
  return map3(fogCoverColor(fogCoverPuffs(top, time), fogColor), (component, index) =>
    component * (1 + (hollow * shade[index]! - 1) * tint));
};

export const getMapInterior = (xz: Vec2, worldSize: Vec2) => {
  if (worldSize[0] <= 0) return 1;
  const insideX = Math.min(xz[0], worldSize[0] - xz[0]);
  const insideY = Math.min(xz[1], worldSize[1] - xz[1]);
  return smoothstep(0, MAP_EDGE_CELLS, Math.min(insideX, insideY));
};

export const applyMapEdge = (color: Rgb, xz: Vec2, worldSize: Vec2): Rgb => {
  if (worldSize[0] <= 0) return color;
  const beyondX = Math.max(-xz[0], xz[0] - worldSize[0]);
  const beyondY = Math.max(-xz[1], xz[1] - worldSize[1]);
  const outside = Math.max(beyondX, beyondY, 0);
  const border = 0.72 + 0.28 * getMapInterior(xz, worldSize);
  const bordered: Rgb = [color[0] * border, color[1] * border, color[2] * border];
  return mix(bordered, FAR_SEA_HAZE, smoothstep(4, 60, outside) * 0.85);
};

export const applyFogClouds = (color: Rgb, visibility: number, xz: Vec2, time: number,
  explorationFog: number, fogOfWarLit: number, fogColor: Rgb, rain = 0,
  viewDirection: Vec3 = [0, 0, 1], sunDirection: Vec3 = [0, 1, 0],
  sunColor: Rgb = [1, 1, 1]): Rgb => {
  if (explorationFog >= 1 || visibility >= FOG_CLEAR_VISIBILITY) return color;
  const grey = 0.3 * color[0] + 0.59 * color[1] + 0.11 * color[2];
  const discovered = 1 - smoothstep(0.55, FOG_CLEAR_VISIBILITY, visibility);
  const desaturated = mix(color, [grey * 0.82 + 0.02, grey * 0.82 + 0.03, grey * 0.82 + 0.06],
    discovered * 0.5);
  const drift = fbm3(xz[0] * 0.09 + time * 0.04, xz[1] * 0.09 + time * 0.015) - 0.5;
  const hidden = 1 - fogVisibilityFade(visibility + drift * 0.35);
  const puffs = fogCoverPuffs(xz, time);
  const litCover = fogOfWarLit > 0.5 && hidden > 0.004;
  const cloud = litCover
    ? litFogCover(puffs, xz, time, viewDirection, sunDirection, sunColor, rain, fogColor)
    : fogCoverColor(puffs, fogColor);
  return mix(mix(desaturated, cloud, hidden * 0.96), color, explorationFog);
};

export const applyFogOfWar = (color: Rgb, visibility: number, xz: Vec2, worldSize: Vec2,
  time: number, explorationFog: number, fogOfWarLit: number, fogColor: Rgb): Rgb =>
  applyMapEdge(applyFogClouds(color, visibility, xz, time, explorationFog, fogOfWarLit, fogColor),
    xz, worldSize);
