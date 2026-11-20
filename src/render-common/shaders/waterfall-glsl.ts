import { FOAM_GLARE_FLOOR } from "../highlights";
import { SHEET_LIFT, SHEET_SINK } from "../water/waterfall-mesh";

/**
 * Brightest display channel a waterfall pixel may reach (RC-0, owner 2026-11-13): below the
 * clipped-white boost of the bloom prefilter (0.97) and only just over the daytime bloom
 * threshold, so sunlit white water glows softly instead of blooming into a blob over the fall.
 */
export const WATERFALL_DISPLAY_PEAK = 0.86;

/**
 * The display cap of every waterfall layer (sheet, foam, mist); needs COLOR_OUTPUT_GLSL before it.
 */
export const WATERFALL_GLARE_GLSL = `
const float FALL_DISPLAY_PEAK = ${WATERFALL_DISPLAY_PEAK.toFixed(3)};

/**
 * Keeps the brightest channel at FALL_DISPLAY_PEAK (hue kept) so the bloom prefilter never sees
 * clipped white on the fall; linear captures stay physical.
 */
vec3 capFallGlare(vec3 color) {
  if (colorIsLinearCapture()) return color;
  float peak = max(color.r, max(color.g, color.b));
  return color * min(1.0, FALL_DISPLAY_PEAK / max(peak, 1e-4));
}
`;

/**
 * Waterfall sheet and foam (needs COMMON_UNIFORMS_GLSL, NOISE_GLSL, LIGHTING_GLSL,
 * FOG_OF_WAR_GLSL, PROP_FOG_GLSL and SURFACE_COLOR_OUTPUT_GLSL before it). The sheet scrolls
 * two streak layers down (faster fine streaks, white water growing towards the foot) and
 * feathers out just above the pool along a ragged, curved line; the foam disc churns at the
 * impact in a soft ring and thins out towards a noise-broken rim.
 */
export const WATERFALL_GLSL = `
${WATERFALL_GLARE_GLSL}
const vec3 FALL_WATER = vec3(0.5, 0.68, 0.74);
const vec3 FALL_FOAM = vec3(0.92, 0.95, 0.96);
const float FALL_SHEET_LIFT = ${SHEET_LIFT.toFixed(3)};
const float FALL_SHEET_SINK = ${SHEET_SINK.toFixed(3)};
const float FALL_FOAM_GLARE_FLOOR = ${FOAM_GLARE_FLOOR.toFixed(2)};

/** White water follows the Highlights / glare setting like the surf foam (water-glsl foamGlare). */
vec3 fallFoamColor() {
  return FALL_FOAM * mix(FALL_FOAM_GLARE_FLOOR, 1.0, uHighlight);
}

/** Height (world units) of a sheet point above the pool surface (waterfall-mesh.ts writeSheet). */
float fallAbovePool(float along, float height) {
  return (height + FALL_SHEET_LIFT) * (1.0 - along) - FALL_SHEET_SINK * along;
}

/**
 * Foot of the sheet: it dissolves into spray at the pool surface, higher up at its sides (a
 * curved foot), along a line the streaks break up; never a straight cut at the water line.
 */
float fallFootFade(vec2 uv, float height, float streak, float fine) {
  float side = (uv.x - 0.5) * 2.0;
  float line = -0.03 + side * side * 0.35 + (streak - 0.5) * 0.12 + (fine - 0.5) * 0.06;
  return smoothstep(line, line + 0.2, fallAbovePool(uv.y, height));
}

vec4 shadeFallSheet(vec2 uv, float height, float seed) {
  float along = uv.y * (1.5 + height * 1.2);
  float streak = valueNoise(vec2(uv.x * 7.0 + seed * 13.0, along * 0.7 - uTime * 1.9));
  float fine = valueNoise(vec2(uv.x * 19.0 - seed * 7.0, along * 1.9 - uTime * 3.4));
  float water = streak * 0.6 + fine * 0.4;
  float impact = 1.0 - smoothstep(0.0, 0.45, fallAbovePool(uv.y, height));
  float foam = smoothstep(0.42, 0.8, water + uv.y * 0.35 + impact * 0.3);
  float ragged = (streak - 0.5) * 0.12;
  float edges = smoothstep(0.0, 0.16 + ragged, uv.x) * smoothstep(1.0, 0.84 - ragged, uv.x);
  float breakup = smoothstep(0.12, 0.42, water + 0.3 - abs(uv.x - 0.5) * 0.7);
  float top = smoothstep(0.0, 0.1, uv.y);
  float foot = fallFootFade(uv, height, streak, fine);
  float alpha = edges * breakup * mix(0.72, 0.94, foam) * top * foot;
  return vec4(mix(FALL_WATER, fallFoamColor(), foam), alpha);
}

vec4 shadeFallFoam(float radius, vec2 xz) {
  float churn = valueNoise(xz * 2.6 + vec2(uTime * 0.7, -uTime * 0.45));
  float bubbles = valueNoise(xz * 6.3 - vec2(uTime * 0.3, uTime * 0.9));
  float ringOffset = (radius - 0.3) / 0.2;
  float ring = exp(-ringOffset * ringOffset);
  float foam = smoothstep(0.3, 0.75, churn * 0.55 + bubbles * 0.45 + (1.0 - radius) * 0.35 + ring * 0.3);
  float rim = 1.0 - smoothstep(0.35, 0.95, radius + (churn - 0.5) * 0.35);
  return vec4(fallFoamColor(), foam * rim * 0.8);
}

/** extra: part (0 sheet, 1 foam), fog visibility, fall height, seed. */
vec4 shadeWaterfall(vec2 uv, vec4 extra, vec3 world) {
  if (isHiddenByFog(extra.y, world.xz)) discard;
  vec4 surface = shadeFallFoam(uv.x, world.xz);
  if (extra.x < 0.5) surface = shadeFallSheet(uv, extra.z, extra.w);
  if (surface.a < 0.02) discard;
  vec3 lit = lightSurface(surface.rgb, vec3(0.0, 1.0, 0.0), 1.0, 1.0, world.xz);
  vec3 color = finishSurface(applyFogOfWar(lit, extra.y, world.xz), world);
  return vec4(capFallGlare(color), surface.a);
}
`;
