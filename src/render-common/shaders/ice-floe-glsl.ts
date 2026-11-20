import { SNOW_MAP_GLSL } from "../snow-map";
import { COMMON_UNIFORMS_GLSL } from "./common-glsl";
import { SEASON_ICE_GLSL } from "./season-ground-glsl";
import { WATER_SWELL_GLSL } from "./water-glsl";

/**
 * Winter ice floes (three-ice-floes.ts): the vertex stage and the ice shading functions. The
 * shading needs COMMON_UNIFORMS, NOISE and LIGHTING (lightSurface, skyIrradiance, skyReflection,
 * cloudShadow). Mesh attributes (ice-floe-geometry.ts): iceCenter = floe centre x, water surface,
 * centre z, water depth; iceData = snow share, height above the waterline, seed, freeboard.
 */

/**
 * Every floe rides the swell at its centre (the same calm-damped waves as the water geometry,
 * WATER_SWELL_GLSL): it lifts with the wave and tilts with its slope, plus a slow own bob.
 * SEASON_ICE (the global season's GPU snow, seasons-5): a floe grows from its centre with the season's
 * ice ramp and shrinks back as it melts; floes in theme winter areas stay full. Vertex stage only.
 */
export const ICE_FLOE_VERTEX_GLSL = `
precision highp float;
in vec3 position;
in vec3 normal;
in vec4 iceCenter;
in vec4 iceData;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
${COMMON_UNIFORMS_GLSL}
${WATER_SWELL_GLSL}
#ifdef SEASON_ICE
${SNOW_MAP_GLSL}
${SEASON_ICE_GLSL}
#endif
out vec3 vWorld;
out vec3 vNormal;
out vec4 vIce;

/** Size of the floe 0..1: full, or under the season's ice the ramp over the theme winter at its centre. */
float getFloeGrowth() {
#ifdef SEASON_ICE
  return max(smoothstep(0.35, 0.8, getSnowMap(iceCenter.xz)), getSeasonIce());
#else
  return 1.0;
#endif
}

void main() {
  vec3 swell = getSwell(iceCenter.xz, uTime) * getSwellCalm(iceCenter.w, vec2(0.0));
  float bob = sin(uTime * 0.7 + iceData.z * 40.0) * 0.008;
  vec3 world = vec3(iceCenter.x, iceCenter.y, iceCenter.z) + position * getFloeGrowth();
  world.y += swell.x + bob + dot(position.xz, swell.yz);
  vWorld = world;
  vNormal = normalize(normal - vec3(swell.y, 0.0, swell.z) * normal.y);
  vIce = iceData;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`;

/** Old snow-dusted pan ice on top; glassy blue-cyan walls darkening to the wet waterline. */
export const ICE_FLOE_SHADING_GLSL = `
const vec3 ICE_SNOW = vec3(0.6, 0.65, 0.71);
const vec3 ICE_TOP = vec3(0.42, 0.54, 0.6);
const vec3 ICE_WALL = vec3(0.52, 0.72, 0.8);
const vec3 ICE_DEEP = vec3(0.24, 0.5, 0.58);
const vec3 ICE_GLOW = vec3(0.45, 0.8, 0.95);
/** The submerged foot seen through the water (the water adds its own absorption on top). */
const vec3 ICE_UNDERWATER = vec3(0.06, 0.17, 0.19);

float getIceSnow(vec2 xz, float snowShare, float seed) {
  float drift = fbm3(xz * 1.1 + seed * 17.0) + (valueNoise(xz * 5.3) - 0.5) * 0.12;
  return snowShare * smoothstep(0.3, 0.5, drift + 0.08 * snowShare);
}

vec3 getIceAlbedo(vec2 xz, vec3 normal, vec4 ice, float snow) {
  float below = clamp(1.0 - ice.y / max(ice.w, 0.05), 0.0, 1.4);
  vec3 wall = mix(ICE_WALL, ICE_DEEP, smoothstep(0.1, 1.1, below)) * (0.94 + 0.12 * valueNoise(xz * 2.7));
  vec3 bare = ICE_TOP * (0.93 + 0.12 * valueNoise(xz * 4.1 + ice.z * 5.0));
  vec3 top = mix(bare, ICE_SNOW, snow);
  float wet = 1.0 - smoothstep(-0.01, 0.045, ice.y);
  return mix(wall, top, smoothstep(0.5, 0.88, normal.y)) * mix(1.0, 0.85, wet);
}

/** Wind-packed drifts and pressure bumps on the top (light only; the slab outline stays the geometry). */
vec3 getIceReliefNormal(vec3 normal, vec2 xz) {
  vec2 tilt = (valueNoise4(xz * 1.4).zw - 0.5) * 0.35 + (valueNoise4(xz * 4.6).xy - 0.5) * 0.12;
  return normalize(normal + vec3(tilt.x, 0.0, tilt.y) * smoothstep(0.6, 0.95, normal.y));
}

/** Cheap translucency: wrapped sun through the thin walls plus a view-against-sun glow and a rim. */
vec3 getIceTransmission(vec3 normal, vec3 view, float topness, vec2 xz) {
  float wrap = clamp((dot(normal, uSunDirection) + 0.6) / 1.6, 0.0, 1.0);
  float back = pow(clamp(dot(-view, uSunDirection), 0.0, 1.0), 4.0);
  float rim = pow(1.0 - clamp(dot(normal, view), 0.0, 1.0), 3.0);
  float walls = 1.0 - topness;
  vec3 sun = uSunColor * cloudShadow(xz);
  // Light scattered inside the slab keeps shaded walls glowing blue instead of turning slate grey.
  vec3 scattered = skyIrradiance(vec3(0.0, 1.0, 0.0)) * 0.14 * walls;
  return ICE_GLOW * (sun * (wrap * 0.08 + back * 0.25) * walls + skyIrradiance(normal) * rim * 0.12 + scattered);
}

/**
 * Ice keeps its cold hue under a warm sky: where the lit colour turns pink or violet (dawn, dusk), the
 * walls (and a little of the top) move towards a blue-cyan of the same brightness. Already cold
 * daylight colours stay as they are.
 */
vec3 keepIceCold(vec3 color, float topness) {
  float brightness = dot(color, vec3(0.299, 0.587, 0.114));
  float warmth = clamp((color.r - 0.85 * color.b) / max(brightness, 1e-3) * 3.0, 0.0, 1.0);
  return mix(color, brightness * vec3(0.66, 0.9, 1.1), mix(0.55, 0.3, topness) * warmth);
}

/** Submerged foot: muted turquoise, fading into the water with depth and towards grazing views. */
float getIceUnderwaterFade(float height, vec3 view) {
  float depth = clamp(-height / 0.2, 0.0, 1.0);
  float grazing = 1.0 - smoothstep(0.2, 0.75, abs(view.y));
  return max(depth, grazing);
}

vec3 shadeIceUnderwater(float height, vec3 view, vec2 xz) {
  vec3 light = lightSurface(vec3(1.0), vec3(0.0, 1.0, 0.0), 1.0, 1.0, xz);
  return ICE_UNDERWATER * light * mix(1.0, 0.3, getIceUnderwaterFade(height, view));
}

float getIceUnderwaterColumn(float height, vec3 view) {
  return 0.52 + 0.13 * getIceUnderwaterFade(height, view);
}

vec3 getIceSpecular(vec2 xz, vec3 normal, vec3 view, float snow, float sunVisibility) {
  vec2 ripple = (valueNoise4(xz * 3.3).xy - 0.5) * 0.12;
  vec3 bumped = normalize(normal + vec3(ripple.x, 0.0, ripple.y) * normal.y);
  vec3 halfway = normalize(uSunDirection + view);
  float gloss = 1.0 - snow;
  float facing = max(dot(bumped, halfway), 0.0);
  // Bare ice: a small sharp glint broken up by the surface ripple; snow only a faint broad sheen.
  float highlight = pow(facing, 400.0) * gloss * 0.6 + pow(facing, 16.0) * snow * 0.03;
  float fresnel = 0.04 + 0.96 * pow(1.0 - clamp(dot(bumped, view), 0.0, 1.0), 5.0);
  vec3 sky = skyReflection(reflect(-view, bumped)) * fresnel * gloss * 0.12;
  return sky + uSunColor * highlight * sunVisibility * cloudShadow(xz) * uHighlight;
}
`;
