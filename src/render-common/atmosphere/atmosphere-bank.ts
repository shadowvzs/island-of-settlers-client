import type { AtmosphereVec3 } from "./atmosphere-height";
import { type AtmosphereRay, sanitizeAtmosphereRay } from "./atmosphere-ray";

/** A world-anchored, vertically flattened mist volume. */
export interface AtmosphereBank {
  center: AtmosphereVec3;
  /** Horizontal radius in world units. */
  radius: number;
}

export interface AtmosphereBankProfile {
  /** Extinction inside the bank, inverse world units. */
  density: number;
  /** Softness of the outer shell, 0..1. */
  softness: number;
  /** Vertical radius relative to the horizontal radius. */
  verticalScale: number;
}

/** GLSL samples the soft shell at these fractions of the chord. */
const SAMPLE_FRACTIONS = [0.25, 0.5, 0.75] as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const smoothstep = (edge0: number, edge1: number, value: number) => {
  if (!(edge1 > edge0)) return value >= edge1 ? 1 : 0;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * CPU mirror of the shader's camera occupancy gate: a bank contributes only while the eye is
 * inside its soft shell. Omitting the eye keeps the path-only math used to test the volume
 * integral itself.
 */
export const atmosphereBankEyeVisibility = (
  eye: AtmosphereVec3,
  bank: AtmosphereBank,
  profile: AtmosphereBankProfile
): number => {
  const density = Number.isFinite(profile.density) ? Math.max(0, profile.density) : 0;
  const radius = Number.isFinite(bank.radius) ? Math.max(0, bank.radius) : 0;
  if (!(density > 0) || !(radius > 0) || !eye.every(Number.isFinite)) return 0;
  const verticalScale = clamp(
    Number.isFinite(profile.verticalScale) ? profile.verticalScale : 1,
    0.05,
    1
  );
  const softness = clamp(Number.isFinite(profile.softness) ? profile.softness : 0.55, 0.05, 0.95);
  const [centerX, centerY, centerZ] = bank.center;
  if (![centerX, centerY, centerZ].every(Number.isFinite)) return 0;
  const inverseRadius = 1 / radius;
  const inverseVertical = inverseRadius / verticalScale;
  const distance = Math.hypot(
    (eye[0] - centerX) * inverseRadius,
    (eye[1] - centerY) * inverseVertical,
    (eye[2] - centerZ) * inverseRadius
  );
  return 1 - smoothstep(1 - softness, 1, distance);
};

/**
 * CPU mirror of the GLSL soft ellipsoid: clip the ray to the scaled sphere, then average the
 * radial density over three fixed samples. It is an approximation, not an exact integral.
 * Pass the eye to apply the same camera-inside-the-bank gate as the shader.
 */
export const atmosphereBankSegmentDensity = (
  ray: AtmosphereRay,
  bank: AtmosphereBank,
  profile: AtmosphereBankProfile,
  eye?: AtmosphereVec3
): number => {
  const safeRay = sanitizeAtmosphereRay(ray);
  const radius = Number.isFinite(bank.radius) ? Math.max(0, bank.radius) : 0;
  const density = Number.isFinite(profile.density) ? Math.max(0, profile.density) : 0;
  if (!(radius > 0) || !(density > 0) || !(safeRay.length > 0)) return 0;
  const eyeVisibility = eye ? atmosphereBankEyeVisibility(eye, bank, profile) : 1;
  if (!(eyeVisibility > 0)) return 0;
  const verticalScale = clamp(
    Number.isFinite(profile.verticalScale) ? profile.verticalScale : 1,
    0.05,
    1
  );
  const softness = clamp(Number.isFinite(profile.softness) ? profile.softness : 0.55, 0.05, 0.95);
  const [centerX, centerY, centerZ] = bank.center;
  if (![centerX, centerY, centerZ].every(Number.isFinite)) return 0;
  const inverseRadius = 1 / radius;
  const inverseVertical = inverseRadius / verticalScale;
  const origin = [
    (safeRay.origin[0] - centerX) * inverseRadius,
    (safeRay.origin[1] - centerY) * inverseVertical,
    (safeRay.origin[2] - centerZ) * inverseRadius
  ] as const;
  const direction = [
    safeRay.direction[0] * inverseRadius,
    safeRay.direction[1] * inverseVertical,
    safeRay.direction[2] * inverseRadius
  ] as const;
  const a = direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2;
  if (!(a > 0)) return 0;
  const b = origin[0] * direction[0] + origin[1] * direction[1] + origin[2] * direction[2];
  const c = origin[0] ** 2 + origin[1] ** 2 + origin[2] ** 2 - 1;
  const discriminant = b ** 2 - a * c;
  if (!(discriminant > 0)) return 0;
  const root = Math.sqrt(discriminant);
  const start = Math.max((-b - root) / a, 0);
  const end = Math.min((-b + root) / a, safeRay.length);
  const chord = end - start;
  if (!(chord > 0)) return 0;
  let sampled = 0;
  for (const fraction of SAMPLE_FRACTIONS) {
    const t = start + chord * fraction;
    const x = origin[0] + direction[0] * t;
    const y = origin[1] + direction[1] * t;
    const z = origin[2] + direction[2] * t;
    sampled += 1 - smoothstep(1 - softness, 1, Math.hypot(x, y, z));
  }
  return density * chord * (sampled / SAMPLE_FRACTIONS.length) * eyeVisibility;
};

/** Additive optical depth of up to two banks, matching the shader's pair and camera gate. */
export const atmosphereBankOpticalDepth = (
  ray: AtmosphereRay,
  banks: readonly AtmosphereBank[],
  profile: AtmosphereBankProfile,
  eye?: AtmosphereVec3
): number => {
  let opticalDepth = 0;
  for (const bank of banks.slice(0, 2)) {
    opticalDepth += atmosphereBankSegmentDensity(ray, bank, profile, eye);
  }
  return Number.isFinite(opticalDepth) ? opticalDepth : 0;
};

/** Packs one bank as a vec4 uniform: centre xyz, horizontal radius. */
export const toAtmosphereBankUniform = (bank: AtmosphereBank): readonly [number, number, number, number] => {
  const safe = (value: number) => Number.isFinite(value) ? value : 0;
  return [
    safe(bank.center[0]),
    safe(bank.center[1]),
    safe(bank.center[2]),
    Math.max(0, safe(bank.radius))
  ];
};
