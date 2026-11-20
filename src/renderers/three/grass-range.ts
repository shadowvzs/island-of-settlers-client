import { getGrassRingTuftKeep, type GrassRingSettings } from "../../render-common/grass/grass-ring-layout";
import { smoothstep } from "../../shared/world/noise";

export const GRASS_RANGE_OFF = 1e9;
export const GRASS_FADE_START_SHARE = 0.6;
export const GRASS_CHUNK_MARGIN = 16;
export const GRASS_RANK_BAND = 0.2;

export interface GrassRange {
  chunkDistance: number;
  end: number;
  start: number;
  x: number;
  z: number;
}

/** Per-frame grass distance range; both inputs missing keeps the old whole-chunk behaviour. */
export const getGrassRange = (
  eye: { x: number; z: number } | undefined,
  grassDistance: number | undefined
): GrassRange => {
  if (!eye || grassDistance === undefined)
    return {
      chunkDistance: GRASS_RANGE_OFF,
      end: GRASS_RANGE_OFF,
      start: GRASS_RANGE_OFF,
      x: 0,
      z: 0
    };
  return {
    chunkDistance: grassDistance + GRASS_CHUNK_MARGIN,
    end: grassDistance,
    start: GRASS_FADE_START_SHARE * grassDistance,
    x: eye.x,
    z: eye.z
  };
};

/**
 * OD-T6 / grass-band mirror of the shader's ring hole for the short-grass tufts: inside the possessed
 * grass ring they keep only the cover the ring's blades no longer give (`getGrassRingTuftKeep`);
 * `blend` (the possession blend, 0 in iso) scales the hole in; `noise` is the world value noise (0..1).
 */
export const grassHoleKeepAt = (settings: GrassRingSettings, distance: number, blend: number, noise = 0) => {
  if (blend <= 0) return 1;
  return 1 + (getGrassRingTuftKeep(settings, distance, noise) - 1) * Math.min(1, blend);
};

/** Mirror of the shader's per-tuft keep: 1 whole, 0 gone, nested by the stable rank. */
export const grassKeepAt = (distance: number, rank: number, start: number, end: number, hole = 1) => {
  const keep = (1 - smoothstep(start, end, distance)) * hole;
  return Math.min(1, Math.max(0, (keep * (1 + GRASS_RANK_BAND) - rank) / GRASS_RANK_BAND));
};
