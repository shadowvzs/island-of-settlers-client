/**
 * Coarse terrain occlusion of the sun for the possessed view: one march along the sun's azimuth
 * through the read-only height query, returning the visible share of the disc (0..1). It gates the
 * glare only; the disc itself is hidden by the depth-tested scene. Pure CPU, allocation-free.
 */
import type { SunDirection } from "../../../shared/world/world-data";
import { EXPLORATION_SUN_DISC_RADIUS } from "./exploration-sky-disc-glsl";

const SAMPLES = 24;
const FIRST_DISTANCE = 1.5;
/** Geometric spacing: 24 samples reach about 255 cells, the far side of a 256-cell island. */
const GROWTH = 1.25;

export interface SunOcclusionPoint {
  x: number;
  y: number;
  z: number;
}

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Steepest terrain elevation angle (radians) seen from the eye along a unit horizontal heading. */
const terrainHorizonAngle = (
  eye: SunOcclusionPoint, headingX: number, headingZ: number,
  groundHeight: (x: number, z: number) => number
) => {
  let steepest = -Infinity;
  let distance = FIRST_DISTANCE;
  for (let sample = 0; sample < SAMPLES; sample++) {
    const height = groundHeight(eye.x + headingX * distance, eye.z + headingZ * distance);
    if (Number.isFinite(height)) steepest = Math.max(steepest, (height - eye.y) / distance);
    distance *= GROWTH;
  }
  return Number.isFinite(steepest) ? Math.atan(steepest) : -Math.PI / 2;
};

/**
 * Visible share of a sun disc of `angularRadius` (radians) toward unit vector `sun`. An overhead
 * sun, a missing height query or non-finite input never occludes.
 */
export const sunTerrainVisibility = (
  eye: SunOcclusionPoint,
  sun: SunOcclusionPoint,
  angularRadius: number,
  groundHeight?: (x: number, z: number) => number
) => {
  const horizontal = Math.hypot(sun.x, sun.z);
  if (!groundHeight || !(horizontal > 1e-4) || !Number.isFinite(eye.y)) return 1;
  const sunAngle = Math.atan2(sun.y, horizontal);
  const horizon = terrainHorizonAngle(eye, sun.x / horizontal, sun.z / horizontal, groundHeight);
  return smoothstep(-angularRadius, angularRadius, sunAngle - horizon);
};

const lightVector = { x: 0, y: 0, z: 0 };

/** Terrain-visible share of the environment light's disc seen from the possessed eye. */
export const explorationSunVisibility = (
  sun: SunDirection, eye: SunOcclusionPoint, groundHeight?: (x: number, z: number) => number
) => {
  const horizontal = Math.cos(sun.elevation);
  lightVector.x = sun.azimuthX * horizontal;
  lightVector.y = Math.sin(sun.elevation);
  lightVector.z = sun.azimuthZ * horizontal;
  return sunTerrainVisibility(eye, lightVector, EXPLORATION_SUN_DISC_RADIUS, groundHeight);
};
