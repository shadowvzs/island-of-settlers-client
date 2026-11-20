/**
 * Snowy shore (winter-coast lane, owner 2026-11-12): on islands with theme snow the dry beach sand
 * between the snow and the sea takes the snow layer, while the swash band at the waterline keeps
 * its darkened wet sand, cooled to a frozen grey, so the coastline stays readable. Render-only
 * splat weights: the world's materials, navigation and saves are untouched.
 *
 * Compiled only into terrain of worlds with snow areas (SNOW_SHORE); needs the ground variant's
 * SNOW_MAP_GLSL and NOISE. Shared by the full and the lite ground (one snow map fetch on the lite).
 */
import { MATERIAL } from "../../shared/world/world-data";

/** Splat channel of the sand and the snow layers (splatB holds materials 4..7). */
const SPLAT_B_FIRST = 4;
const SAND_CHANNEL = "xyzw"[MATERIAL.sand - SPLAT_B_FIRST];
const SNOW_CHANNEL = "xyzw"[MATERIAL.snow - SPLAT_B_FIRST];

export const SNOWY_SHORE_GLSL = `
/** Coast distance (cells, signed, water field) where the beach snow starts and where it is full. */
const vec2 SHORE_SNOW_COAST = vec2(0.25, 0.7);
/** Coast distance where the frozen tint of the wet band fades out. */
const vec2 WET_SHORE_COAST = vec2(0.45, 0.9);
const vec3 FROZEN_SAND_TINT = vec3(0.86, 0.93, 1.0);

/** Share of the beach sand at this point that lies under snow (ragged, never a ruled line). */
float getShoreSnow(vec2 xz, float coast) {
  float ragged = coast + (valueNoise(xz * 1.3 + 4.1) - 0.5) * 0.4;
  return getSnowMap(xz) * smoothstep(SHORE_SNOW_COAST.x, SHORE_SNOW_COAST.y, ragged);
}

/** Moves the dry beach sand into the snow layer; returns the moved share of the whole ground. */
float coverSnowyShore(inout vec4 splatB, vec2 xz, float coast) {
  if (splatB.${SAND_CHANNEL} <= 0.0) return 0.0;
  float moved = splatB.${SAND_CHANNEL} * getShoreSnow(xz, coast);
  splatB.${SAND_CHANNEL} -= moved;
  splatB.${SNOW_CHANNEL} += moved;
  return moved;
}

/**
 * Water depth the waterline shading sees: the snow laid over the low beach is dry (the wet
 * darkening and swash stay on the remaining sand at the waterline).
 */
float getSnowyShoreDepth(float signedDepth, float shoreSnow) {
  return mix(signedDepth, min(signedDepth, -1.0), shoreSnow);
}

/** The wet band left at the waterline reads as cold, grey wet sand instead of warm yellow. */
vec3 freezeWetShore(vec3 color, vec2 xz, float signedDepth, float coast) {
  float band = (1.0 - smoothstep(-0.02, 0.1, signedDepth))
    * (1.0 - smoothstep(WET_SHORE_COAST.x, WET_SHORE_COAST.y, coast));
  float frozen = band * getSnowMap(xz) * 0.55;
  if (frozen <= 0.0) return color;
  float luma = dot(color, vec3(0.3, 0.59, 0.11));
  return mix(color, luma * FROZEN_SAND_TINT * 0.8, frozen);
}
`;
