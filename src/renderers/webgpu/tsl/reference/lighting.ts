import { SURFACE_LIGHT } from "../../../../render-common/lighting/surface-light";
import { CLOUD_FIELD, CLOUD_HEIGHT } from "../../../../render-common/shaders/cloud-glsl";
import type { Rgb, Vec2, Vec3 } from "./fog";
import { fbm3 } from "./noise";

/** CPU reference of LIGHTING_GLSL (`skyIrradiance`, `cloudShadow`, `lightSurface`). */
export interface LightingReferenceInputs {
  ambientSky: Rgb;
  cloudCover: number;
  cloudDrift: Vec2;
  highlight: number;
  lowOrderSky?: boolean;
  rain: number;
  /** 27 floats: nine RGB SH coefficients (`uSkyIrradiance`). */
  skyIrradiance: ArrayLike<number>;
  sunColor: Rgb;
  sunDirection: Vec3;
  viewDirection: Vec3;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize3 = (a: Vec3): Vec3 => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

/** P_i(n) weights of the nine coefficients; `lowOrder` keeps only the quadratic band's n.y². */
const skyBasis = ([x, y, z]: Vec3, lowOrder: boolean) => {
  if (lowOrder) return [1, y, z, x, 0, 0, -y * y, 0, -y * y];
  return [1, y, z, x, x * y, y * z, 3 * z * z - 1, x * z, x * x - y * y];
};

export const skyIrradiance = (coefficients: ArrayLike<number>, normal: Vec3,
  lowOrder = false): Rgb => {
  const basis = skyBasis(normal, lowOrder);
  const channel = (offset: number) => Math.max(0, basis.reduce((sum, weight, index) =>
    sum + coefficients[index * 3 + offset]! * weight, 0));
  return [channel(0), channel(1), channel(2)];
};

export const cloudShadow = (xz: Vec2, inputs: LightingReferenceInputs) => {
  const { cloudCover, cloudDrift, sunDirection } = inputs;
  const lift = CLOUD_HEIGHT / Math.max(sunDirection[1], CLOUD_FIELD.shadowMinSunHeight);
  const x = (xz[0] + sunDirection[0] * lift) * CLOUD_FIELD.noiseScale
    + cloudDrift[0] * CLOUD_FIELD.driftScale;
  const y = (xz[1] + sunDirection[2] * lift) * CLOUD_FIELD.noiseScale
    + cloudDrift[1] * CLOUD_FIELD.driftScale;
  const edge = 1 - cloudCover;
  const density = smoothstep(edge, edge + CLOUD_FIELD.edgeWidth, fbm3(x, y));
  return 1 + (CLOUD_FIELD.shadowShade - 1) * density;
};

export const lightSurface = (albedo: Rgb, normal: Vec3, sunVisibility: number, occlusion: number,
  xz: Vec2, inputs: LightingReferenceInputs): Rgb => {
  const { ambientSky, highlight, lowOrderSky = false, rain, skyIrradiance: coefficients, sunColor,
    sunDirection, viewDirection } = inputs;
  const wrapped = clamp01((dot3(normal, sunDirection) + SURFACE_LIGHT.sunWrap)
    / (1 + SURFACE_LIGHT.sunWrap));
  const sky = skyIrradiance(coefficients, normal, lowOrderSky);
  const sun = wrapped * sunVisibility * cloudShadow(xz, inputs);
  const wet = 1 - rain * SURFACE_LIGHT.rainDarkening;
  const halfway = normalize3([sunDirection[0] + viewDirection[0], sunDirection[1] + viewDirection[1],
    sunDirection[2] + viewDirection[2]]);
  const sheen = Math.max(dot3(normal, halfway), 0) ** SURFACE_LIGHT.sheenPower * rain * highlight
    * smoothstep(SURFACE_LIGHT.sheenSlopeStart, SURFACE_LIGHT.sheenSlopeEnd, normal[1]);
  const channel = (index: 0 | 1 | 2) => albedo[index] * wet
    * (sunColor[index] * sun + sky[index] * occlusion * SURFACE_LIGHT.skyShare)
    + (sunColor[index] * SURFACE_LIGHT.sheenSun + ambientSky[index] * SURFACE_LIGHT.sheenSky) * sheen;
  return [channel(0), channel(1), channel(2)];
};
