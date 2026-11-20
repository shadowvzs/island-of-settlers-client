import { describe, expect, it } from "vitest";

import {
  ATMOSPHERE_MAX_OPTICAL_DEPTH,
  atmosphereDensityAtHeight,
  type AtmosphereProfile,
  type AtmosphereVec3,
  integrateAtmosphereHeightDensity,
  sanitizeAtmosphereProfile,
  toAtmosphereProfileUniform,
} from "../src/render-common/atmosphere/atmosphere-height";
import {
  type AtmosphereBounds,
  atmosphereOpticalDepth,
  type AtmosphereRay,
  atmosphereSkyRay,
  atmosphereSurfaceRay,
  clipAtmosphereRay,
  getAtmosphereBoundsDiagonal,
  normalizeAtmosphereDirection,
  sanitizeAtmosphereBounds,
} from "../src/render-common/atmosphere/atmosphere-ray";

const BOUNDS: AtmosphereBounds = { max: [120, 70, 80], min: [-100, 0, -60] };
const PROFILE: AtmosphereProfile = { extinction: 0.02, falloff: 0.08, referenceHeight: 4.5 };
const SAMPLES = 8192;

const createRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const randomBetween = (random: () => number, min: number, max: number): number =>
  min + (max - min) * random();

const randomUnitVector = (random: () => number): AtmosphereVec3 => {
  const y = randomBetween(random, -1, 1);
  const angle = randomBetween(random, 0, Math.PI * 2);
  const radius = Math.sqrt(1 - y * y);
  return [radius * Math.cos(angle), y, radius * Math.sin(angle)];
};

const pointAt = (ray: AtmosphereRay, distance: number): AtmosphereVec3 => [
  ray.origin[0] + ray.direction[0] * distance,
  ray.origin[1] + ray.direction[1] * distance,
  ray.origin[2] + ray.direction[2] * distance,
];

const isInsideBounds = (point: AtmosphereVec3, bounds: AtmosphereBounds): boolean =>
  point.every(
    (component, axis) =>
      component >= bounds.min[axis]! - 1e-5 && component <= bounds.max[axis]! + 1e-5,
  );

const expectClose = (actual: number, expected: number, relative = 2e-6) => {
  const tolerance = 1e-7 + Math.abs(expected) * relative;
  expect(Math.abs(actual - expected)).toBeLessThan(tolerance);
};

/** Independent midpoint quadrature of the contract density definition. */
const numericalDepth = (
  startHeight: number,
  directionY: number,
  length: number,
  profile: AtmosphereProfile,
  samples = SAMPLES,
): number => {
  const step = length / samples;
  let opticalDepth = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    const height = startHeight + directionY * (sample + 0.5) * step;
    const density = profile.extinction *
      Math.exp(-profile.falloff * Math.max(height - profile.referenceHeight, 0));
    opticalDepth += density * step;
  }
  return opticalDepth;
};

const numericalRayDepth = (ray: AtmosphereRay, profile: AtmosphereProfile): number =>
  numericalDepth(ray.origin[1], ray.direction[1], ray.length, profile);

describe("atmosphere analytical integration", () => {
  it("sanitizes profiles and keeps density constant below the reference height", () => {
    expect(
      sanitizeAtmosphereProfile({
        extinction: Number.NaN,
        falloff: Number.POSITIVE_INFINITY,
        referenceHeight: Number.NEGATIVE_INFINITY,
      }),
    ).toEqual({ extinction: 0, falloff: 0, referenceHeight: 0 });
    expect(toAtmosphereProfileUniform(PROFILE, true)).toEqual([
      Math.fround(PROFILE.extinction),
      Math.fround(PROFILE.falloff),
      Math.fround(PROFILE.referenceHeight),
      1,
    ]);
    expect(toAtmosphereProfileUniform(PROFILE, false).every(Number.isFinite)).toBe(true);
    expect(
      sanitizeAtmosphereBounds({ max: [Number.POSITIVE_INFINITY, 1, 2], min: [0, 0, 0] }).max,
    ).toEqual([0, 0, 0]);
    const safe = sanitizeAtmosphereProfile(PROFILE);
    const below = atmosphereDensityAtHeight(PROFILE, safe.referenceHeight - 50);
    const above = atmosphereDensityAtHeight(PROFILE, safe.referenceHeight + 5);
    expect(below).toBeCloseTo(safe.extinction, 7);
    expect(above).toBeCloseTo(safe.extinction * Math.exp(-safe.falloff * 5), 7);
  });
});

describe("atmosphere ray geometry and integration", () => {
  it("clips finite rays robustly against the AABB and rejects misses", () => {
    const path: AtmosphereRay = {
      origin: [-200, 20, -50],
      direction: normalizeAtmosphereDirection([1, -0.1, 1])!,
      length: 800,
    };
    const clipped = clipAtmosphereRay(path, BOUNDS);
    expect(clipped.length).toBeGreaterThan(0);
    expect(isInsideBounds(clipped.origin, BOUNDS)).toBe(true);
    expect(isInsideBounds(pointAt(clipped, clipped.length), BOUNDS)).toBe(true);
    const miss = clipAtmosphereRay(
      { origin: [-300, 200, -300], direction: normalizeAtmosphereDirection([1, 1, 1])!, length: 100 },
      BOUNDS,
    );
    expect(miss.length).toBe(0);
    const horizontalOutside = clipAtmosphereRay(
      { origin: [-50, 100, -20], direction: [1, 0, 0], length: 50 },
      BOUNDS,
    );
    expect(horizontalOutside.length).toBe(0);
    expect(clipAtmosphereRay(path, { max: [10, 0, 10], min: [0, 0, 0] }).length).toBe(0);
    const swapped = sanitizeAtmosphereBounds({ max: BOUNDS.min, min: BOUNDS.max });
    expect(swapped.min).toEqual(Array.from(BOUNDS.min));
    expect(swapped.max).toEqual(Array.from(BOUNDS.max));
  });

  it("normalizes rays and ignores the eye offset for orthographic starts", () => {
    const worldPosition: AtmosphereVec3 = [40, 25, 10];
    const forward = normalizeAtmosphereDirection([0, -1, 0.3])!;
    const orthographic = (eye: AtmosphereVec3) =>
      atmosphereSurfaceRay({ bounds: BOUNDS, eye, forward, orthographic: true, worldPosition });
    const first = orthographic([0, 300, 0]);
    expect(orthographic([500000, -400000, 800000])).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
    expect(Math.hypot(...first.direction)).toBeCloseTo(1, 12);
    const firstEnd = pointAt(first, first.length);
    expect(Math.hypot(...firstEnd.map((value, axis) => value - worldPosition[axis]!))).toBeLessThan(
      1e-4,
    );
    const perspective = atmosphereSurfaceRay({
      bounds: BOUNDS,
      eye: [-20, 130, 150],
      forward,
      orthographic: false,
      worldPosition,
    });
    expect(perspective.length).toBeGreaterThan(0);
    expect(Math.hypot(...perspective.direction)).toBeCloseTo(1, 12);
    const sky = atmosphereSkyRay({ bounds: BOUNDS, direction: [0.3, -0.4, 0.2], eye: [0, 30, 0] });
    expect(sky.length).toBeGreaterThan(0);
    expect(sky.length).toBeLessThanOrEqual(2 * getAtmosphereBoundsDiagonal(BOUNDS));
    expect(Math.hypot(...sky.direction)).toBeCloseTo(1, 12);
  });

  it("scales orthographic fog with the current view depth", () => {
    const worldPosition: AtmosphereVec3 = [40, 2, 10];
    const forward: AtmosphereVec3 = [0, -1, 0];
    const profile = { extinction: 0.00065, falloff: 0.065, referenceHeight: 2 };
    const shortRay = atmosphereSurfaceRay({
      bounds: BOUNDS,
      eye: [0, 1000, 0],
      forward,
      orthographic: true,
      orthoPathLength: 8,
      worldPosition,
    });
    const longRay = atmosphereSurfaceRay({
      bounds: BOUNDS,
      eye: [0, 1000, 0],
      forward,
      orthographic: true,
      orthoPathLength: 400,
      worldPosition,
    });
    expect(shortRay.length).toBeCloseTo(8, 6);
    expect(longRay.length).toBeCloseTo(400, 6);
    const nearDepth = atmosphereOpticalDepth(shortRay, BOUNDS, profile);
    const farDepth = atmosphereOpticalDepth(longRay, BOUNDS, profile);
    expect(nearDepth).toBeLessThan(0.005);
    expect(farDepth).toBeGreaterThan(nearDepth * 2);
    // A camera plane close to the surface cannot be extended backwards into extra fog.
    const nearCamera = atmosphereSurfaceRay({
      bounds: BOUNDS,
      eye: [40, 3, 10],
      forward,
      orthographic: true,
      orthoPathLength: 400,
      worldPosition,
    });
    expect(nearCamera.length).toBeCloseTo(1, 6);
    expect(atmosphereOpticalDepth(nearCamera, BOUNDS, profile)).toBeLessThan(0.001);
    // The legacy full-volume path remains available when no view depth is supplied.
    expect(atmosphereSurfaceRay({
      bounds: BOUNDS,
      eye: [0, 300, 0],
      forward,
      orthographic: true,
      worldPosition,
    }).length).toBeCloseTo(2 * getAtmosphereBoundsDiagonal(BOUNDS), 4);
  });

  it("matches independent quadrature on seeded random rays and height segments", () => {
    const random = createRandom(0x5eed1234);
    for (let index = 0; index < 24; index += 1) {
      const ray: AtmosphereRay = {
        origin: [
          randomBetween(random, BOUNDS.min[0], BOUNDS.max[0]),
          randomBetween(random, BOUNDS.min[1], BOUNDS.max[1]),
          randomBetween(random, BOUNDS.min[2], BOUNDS.max[2]),
        ],
        direction: randomUnitVector(random),
        length: randomBetween(random, 20, 400),
      };
      const clipped = clipAtmosphereRay(ray, BOUNDS);
      expect(clipped.length).toBeGreaterThan(0);
      expectClose(atmosphereOpticalDepth(ray, BOUNDS, PROFILE), numericalRayDepth(clipped, PROFILE));
    }
    for (let index = 0; index < 20; index += 1) {
      const startHeight = randomBetween(random, -10, 90);
      const directionY = randomBetween(random, -1, 1);
      const length = randomBetween(random, 0, 200);
      const expected = numericalDepth(startHeight, directionY, length, PROFILE);
      const actual = integrateAtmosphereHeightDensity({
        directionY,
        length,
        profile: PROFILE,
        startHeight,
      });
      expectClose(actual, expected);
    }
  });

  it("preserves optical depth under reversal and splits reference crossings", () => {
    const clipped = clipAtmosphereRay(
      {
        origin: [-80, 65, -40],
        direction: normalizeAtmosphereDirection([0.7, -1, 0.35])!,
        length: 300,
      },
      BOUNDS,
    );
    const end = pointAt(clipped, clipped.length);
    const reversed = clipAtmosphereRay(
      {
        origin: end,
        direction: [
          -clipped.direction[0],
          -clipped.direction[1],
          -clipped.direction[2],
        ],
        length: clipped.length,
      },
      BOUNDS,
    );
    expect(clipped.origin[1]).toBeGreaterThan(PROFILE.referenceHeight);
    expect(end[1]).toBeLessThan(PROFILE.referenceHeight);
    const forwardDepth = atmosphereOpticalDepth(clipped, BOUNDS, PROFILE);
    const reverseDepth = atmosphereOpticalDepth(reversed, BOUNDS, PROFILE);
    expect(forwardDepth).toBeGreaterThan(0);
    expectClose(reverseDepth, forwardDepth, 2e-5);
    expectClose(forwardDepth, numericalRayDepth(clipped, PROFILE));
  });

  it("keeps zero, disabled and homogeneous cases finite and unchanged", () => {
    const ray: AtmosphereRay = {
      origin: [-90, 20, -50],
      direction: normalizeAtmosphereDirection([1, 0.05, 0.2])!,
      length: 220,
    };
    expect(atmosphereOpticalDepth(ray, BOUNDS, PROFILE, false)).toBe(0);
    expect(atmosphereOpticalDepth(ray, BOUNDS, { ...PROFILE, extinction: 0 })).toBe(0);
    expect(atmosphereOpticalDepth({ ...ray, length: 0 }, BOUNDS, PROFILE)).toBe(0);
    expect(atmosphereOpticalDepth({ ...ray, direction: [0, 0, 0] }, BOUNDS, PROFILE)).toBe(0);
    const clipped = clipAtmosphereRay(ray, BOUNDS);
    const homogeneous = atmosphereOpticalDepth(ray, BOUNDS, { ...PROFILE, falloff: 0 });
    expectClose(homogeneous, PROFILE.extinction * clipped.length);
    expect(homogeneous).toBeLessThanOrEqual(ATMOSPHERE_MAX_OPTICAL_DEPTH);
  });

  it("keeps horizontal and grazing rays finite and bounded", () => {
    const horizontal: AtmosphereRay = {
      origin: [-90, PROFILE.referenceHeight, -50],
      direction: normalizeAtmosphereDirection([1, 0, 0.25])!,
      length: 240,
    };
    const horizontalClipped = clipAtmosphereRay(horizontal, BOUNDS);
    const horizontalDepth = atmosphereOpticalDepth(horizontal, BOUNDS, PROFILE);
    expectClose(horizontalDepth, PROFILE.extinction * horizontalClipped.length);
    const grazing: AtmosphereRay = {
      origin: [-95, 55, -55],
      direction: normalizeAtmosphereDirection([1, 1e-9, 0.3])!,
      length: 240,
    };
    const grazingClipped = clipAtmosphereRay(grazing, BOUNDS);
    const grazingDepth = atmosphereOpticalDepth(grazing, BOUNDS, PROFILE);
    expect(Number.isFinite(grazingDepth)).toBe(true);
    expect(grazingDepth).toBeLessThanOrEqual(ATMOSPHERE_MAX_OPTICAL_DEPTH);
    expectClose(grazingDepth, numericalRayDepth(grazingClipped, PROFILE), 1e-5);
  });
});
