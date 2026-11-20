import { clamp, smoothstep } from "../../shared/world/noise";

/**
 * Cliff material zones, renderer independent. Every rock vertex carries two blend inputs:
 * weathering (0 clean exposed rock .. 1 weathered rock) and loose cover (0 bare .. 1 gravel and
 * soil); the shaders turn them into the clean / weathered / loose material weights.
 */
export interface WeatheringInput {
  /** Crevice depth 0..1. */
  cavity: number;
  /** 0 sheltered or low .. 1 high, steep, freshly exposed face. */
  exposure: number;
  moisture: number;
  /** 0 vertical or overhanging .. 1 facing up (shelves collect soil and moss). */
  upward: number;
}

export const getWeathering = ({ cavity, exposure, moisture, upward }: WeatheringInput) =>
  clamp((1 - exposure) * 0.6 + upward * 0.35 + cavity * 0.3 + moisture * 0.25 - 0.05, 0, 1);

/**
 * Exposure of a spot on a face: tall faces expose fresh rock between the weathered lip (soil,
 * roots) and the foot (talus, splash, vegetation); short faces stay weathered.
 * `heightOnFace` 0 at the foot .. 1 at the lip.
 */
export const getFaceExposure = (heightOnFace: number, faceHeight: number) =>
  smoothstep(0.8, 3.5, faceHeight) *
  smoothstep(0.08, 0.4, heightOnFace) *
  (1 - smoothstep(0.82, 1, heightOnFace) * 0.7);

/** Gravel and soil: where rock meets the ground and on shelves that catch falling debris. */
export const getLooseCover = (contact: number, upward: number) =>
  clamp(contact * 0.85 + upward * upward * 0.45, 0, 1);

/** Normal y as the "faces up" factor (0 at about 27 degrees off vertical .. 1 near flat). */
export const getUpward = (normalY: number) => smoothstep(0.45, 0.85, normalY);

/** 0 facing sideways or up .. 1 facing down: the shaded underside of a lip or overhang. */
export const getOverhang = (normalY: number) => smoothstep(-0.05, -0.6, normalY);

/**
 * Exposure of a sculpted wall: fresh rock on steep faces (more so high on the mountain), joints
 * and shelves stay weathered. `wall` 0 slope .. 1 wall, `altitude` 0..1.
 */
export const getWallExposure = (wall: number, altitude: number, joint: number) =>
  wall * (0.6 + altitude * 0.4) * (1 - joint * 0.5);
