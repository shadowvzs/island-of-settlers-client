import { ATMOSPHERE_GLSL, ATMOSPHERE_UNIFORMS_GLSL } from "../atmosphere/atmosphere-glsl";
import { CONCEALMENT_GLSL, CONCEALMENT_UNIFORMS_GLSL } from "../atmosphere/concealment-glsl";
import { FOG_CLEAR_VISIBILITY, FOG_VISIBILITY_FADE_GLSL } from "../atmosphere/fog-visibility";
import { ATMOSPHERE_VIEW_LIMIT_GLSL } from "../atmosphere/view-limit-glsl";
import { SURFACE_LIGHT } from "../lighting/surface-light";
import { NOISE_LATTICE } from "../noise-textures";
import { CLOUD_FIELD_GLSL } from "./cloud-glsl";
import { glslLiteral } from "./glsl-literal";
/**
 * GLSL ES 3.00 code shared by the renderer's materials: each composes its own main() around
 * these functions, so terrain, water, props, light and fog stay consistent.
 */

/** Cells over which the map fades to black at its border (outside the playable area). */
export const MAP_EDGE_CELLS = 6;
/** Drifting-cover constants shared by the GLSL cover and the TSL fog twin. */
export const FOG_COVER = {
  ambient: 0.7,
  gain: 1.16,
  relief: 4,
  shadowStep: 5,
  slope: 4,
  step: 3,
  sun: 0.45,
  tint: 0.45
} as const;
/** Deep sea haze the open sea beyond the map fades into, far out. */
export const FAR_SEA_HAZE = [0.02, 0.07, 0.11] as const;

export const COMMON_UNIFORMS_GLSL = `
uniform float uTime;
uniform float uCloudCover;
uniform vec2 uCloudDrift;
uniform float uCloudTime;
uniform float uRain;
uniform float uBakedShadowWeight;
uniform vec2 uWind;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uAmbientSky;
uniform vec3 uAmbientGround;
uniform vec3 uFogColor;
uniform vec3 uViewDirection;
/** Highlights / glare setting 0..1 (render-common/highlights.ts): scales glints and specular only. */
uniform float uHighlight;
${ATMOSPHERE_UNIFORMS_GLSL}
${CONCEALMENT_UNIFORMS_GLSL}
float sampleLiveFog(float fallback,vec2 xz) {
  if(uLiveFog<0.5||uWorldSize.x<=0.0)return fallback;
  return texture(uFogMap,clamp(xz/uWorldSize,vec2(0.0),vec2(1.0))).r;
}

/**
 * 1 inside the playable map, falling to 0 over the last MAP_EDGE_CELLS at its border and 0
 * beyond it; always 1 in scenes without a map (uWorldSize 0).
 */
float getMapInterior(vec2 xz) {
  if (uWorldSize.x <= 0.0) return 1.0;
  vec2 inside = min(xz, uWorldSize - xz);
  return smoothstep(0.0, ${MAP_EDGE_CELLS.toFixed(1)}, min(inside.x, inside.y));
}
`;

/** Noise from a tileable texture (see noise-textures.ts): cheap on every GPU, vertex shaders too. */
export const NOISE_GLSL = `
uniform sampler2D uNoiseTexture;
const float NOISE_LATTICE = ${NOISE_LATTICE.toFixed(1)};

float valueNoise(vec2 p) {
  return texture(uNoiseTexture, p / NOISE_LATTICE).r;
}

/** Four independent noise values from one fetch (the texture's channels). */
vec4 valueNoise4(vec2 p) {
  return texture(uNoiseTexture, p / NOISE_LATTICE);
}

float fbm3(vec2 p) {
  return texture(uNoiseTexture, p / NOISE_LATTICE).r * 0.5
    + texture(uNoiseTexture, (p * 2.03 + 17.1) / NOISE_LATTICE).g * 0.3
    + texture(uNoiseTexture, (p * 4.01 + 3.7) / NOISE_LATTICE).b * 0.2;
}
`;

/**
 * The shared SH9 sky light (R05, render-common/lighting/sky-irradiance.ts), in Three's
 * SphericalHarmonics3 order over P = [1, y, z, x, xy, yz, 3z² − 1, xz, x² − y²].
 * `skyIrradiance` replaces the hemisphere ambient: identical for up- and down-facing surfaces,
 * direction dependent in between. Shaders defining SKY_IRRADIANCE_L1 (Minimal's lite ground) keep
 * only the quadratic band's vertical part. `skyReflection` is the sky's radiance in a direction
 * (water reflection).
 */
export const SKY_LIGHT_GLSL = `
uniform vec3 uSkyIrradiance[9];
uniform vec3 uSkyReflection[9];

vec3 skyLinearBand(vec3 coefficients[9], vec3 n) {
  return coefficients[1] * n.y + coefficients[2] * n.z + coefficients[3] * n.x;
}

vec3 skyQuadraticBand(vec3 coefficients[9], vec3 n) {
  return coefficients[4] * (n.x * n.y) + coefficients[5] * (n.y * n.z)
    + coefficients[6] * (3.0 * n.z * n.z - 1.0) + coefficients[7] * (n.x * n.z)
    + coefficients[8] * (n.x * n.x - n.y * n.y);
}

vec3 skyIrradiance(vec3 normal) {
  vec3 irradiance = uSkyIrradiance[0] + skyLinearBand(uSkyIrradiance, normal);
#ifdef SKY_IRRADIANCE_L1
  // Only the quadratic band's vertical part: exact on flat ground, one multiply-add.
  irradiance -= (uSkyIrradiance[6] + uSkyIrradiance[8]) * (normal.y * normal.y);
#else
  irradiance += skyQuadraticBand(uSkyIrradiance, normal);
#endif
  return max(irradiance, vec3(0.0));
}

vec3 skyReflection(vec3 direction) {
  vec3 radiance = uSkyReflection[0] + skyLinearBand(uSkyReflection, direction)
    + skyQuadraticBand(uSkyReflection, direction);
  return max(radiance, vec3(0.0));
}
`;

/** SURFACE_LIGHT as GLSL literals (the generated source is unchanged by the shared constants). */
const LIGHT = {
  rainDarkening: glslLiteral(SURFACE_LIGHT.rainDarkening),
  sheenPower: glslLiteral(SURFACE_LIGHT.sheenPower),
  sheenSky: glslLiteral(SURFACE_LIGHT.sheenSky),
  sheenSlopeEnd: glslLiteral(SURFACE_LIGHT.sheenSlopeEnd),
  sheenSlopeStart: glslLiteral(SURFACE_LIGHT.sheenSlopeStart),
  sheenSun: glslLiteral(SURFACE_LIGHT.sheenSun),
  skyShare: glslLiteral(SURFACE_LIGHT.skyShare),
  sunWrap: glslLiteral(SURFACE_LIGHT.sunWrap),
  sunWrapSpan: glslLiteral(1 + SURFACE_LIGHT.sunWrap)
};

export const LIGHTING_GLSL = `
${CLOUD_FIELD_GLSL}
${SKY_LIGHT_GLSL}

/**
 * A baked sun shadow (terrain, plant instances, impostors: baked for the island's base sun) fades
 * fully as the light moves away from that direction; the real-time shadow map fades on its own,
 * only down to its floor, inside sampleSunShadow (owner 2026-11-07).
 */
float bakedSunVisibility(float baked) {
  return mix(1.0, baked, uBakedShadowWeight);
}

/**
 * Wrapped Lambert sun (or moon) + SH9 sky light, shadow visibility (baked shadow already faded
 * by bakedSunVisibility, times the shadow map), occlusion, cloud shadows; rain darkens surfaces
 * and adds a wet sheen on upward faces.
 */
vec3 lightSurface(vec3 albedo, vec3 normal, float sunVisibility, float occlusion, vec2 xz) {
  float visibility = sunVisibility;
  float wrapped = clamp((dot(normal, uSunDirection) + ${LIGHT.sunWrap}) / ${LIGHT.sunWrapSpan}, 0.0, 1.0);
  vec3 sky = skyIrradiance(normal);
  float clouds = cloudShadow(xz);
  vec3 wetAlbedo = albedo * (1.0 - uRain * ${LIGHT.rainDarkening});
  vec3 color = wetAlbedo * (uSunColor * wrapped * visibility * clouds + sky * occlusion * ${LIGHT.skyShare});
  float sheen = pow(max(dot(normal, normalize(uSunDirection + uViewDirection)), 0.0), ${LIGHT.sheenPower});
  return color + (uSunColor * ${LIGHT.sheenSun} + uAmbientSky * ${LIGHT.sheenSky}) * sheen * uRain * uHighlight
    * smoothstep(${LIGHT.sheenSlopeStart}, ${LIGHT.sheenSlopeEnd}, normal.y);
}
`;

/**
 * R07 (Medium+, fogOfWarStyle "lit"): the drifting cover's puff field read as a soft relief lit
 * by the sun or moon. A fake normal from the field's gradient, self-shadowing toward the light, a
 * darker hollow between puffs and a view parallax (the cover top floats above the ground) make it
 * read as volume. Only the cover's colour changes: the hidden amount per pixel is the flat
 * cover's, so every preset conceals exactly the same cells. Its mean brightness by day matches
 * the flat cover (strategic readability first); rain flattens the relief toward the flat cover.
 */
const LIT_FOG_COVER_GLSL = `
uniform float uFogOfWarLit;
const float FOG_COVER_RELIEF = ${glslLiteral(FOG_COVER.relief)};
const float FOG_COVER_STEP = ${glslLiteral(FOG_COVER.step)};
const float FOG_COVER_SLOPE = ${glslLiteral(FOG_COVER.slope)};
const float FOG_COVER_SHADOW_STEP = ${glslLiteral(FOG_COVER.shadowStep)};
const float FOG_COVER_AMBIENT = ${glslLiteral(FOG_COVER.ambient)};
const float FOG_COVER_SUN = ${glslLiteral(FOG_COVER.sun)};
/** Lifts the shaded cover back to the flat cover's mean (tilted and shadowed tops average darker). */
const float FOG_COVER_GAIN = ${glslLiteral(FOG_COVER.gain)};
/** Share of the light's hue in the sunlit side (the rest keeps the cover's own colour). */
const float FOG_COVER_TINT = ${glslLiteral(FOG_COVER.tint)};

/** Puff height 0..1 of the drifting cover: the flat cover's fbm3 field at explicit LOD 0. */
float fogCoverPuffs(vec2 xz) {
  vec2 p = xz * 0.05 - vec2(uTime * 0.025, 0.0);
  return textureLod(uNoiseTexture, p / NOISE_LATTICE, 0.0).r * 0.5
    + textureLod(uNoiseTexture, (p * 2.03 + 17.1) / NOISE_LATTICE, 0.0).g * 0.3
    + textureLod(uNoiseTexture, (p * 4.01 + 3.7) / NOISE_LATTICE, 0.0).b * 0.2;
}

/** The cover's broad relief: the field's two lower octaves only, so the shading stays soft. */
float fogCoverRelief(vec2 xz) {
  vec2 p = xz * 0.05 - vec2(uTime * 0.025, 0.0);
  return (textureLod(uNoiseTexture, p / NOISE_LATTICE, 0.0).r * 0.5
    + textureLod(uNoiseTexture, (p * 2.03 + 17.1) / NOISE_LATTICE, 0.0).g * 0.3) / 0.8;
}

vec3 fogCoverColor(float puffs) {
  return mix(uFogColor * 0.62, uFogColor * 1.12, smoothstep(0.25, 0.8, puffs));
}

vec3 litFogCover(float puffs, vec2 xz) {
  vec3 toEye = normalize(uViewDirection);
  vec2 top = xz + toEye.xz / max(toEye.y, 0.35) * (FOG_COVER_RELIEF * puffs);
  float relief = fogCoverRelief(top);
  float east = fogCoverRelief(top + vec2(FOG_COVER_STEP, 0.0));
  float south = fogCoverRelief(top + vec2(0.0, FOG_COVER_STEP));
  vec3 normal = normalize(vec3((relief - east) * FOG_COVER_SLOPE, 1.0, (relief - south) * FOG_COVER_SLOPE));
  vec3 light = normalize(uSunDirection);
  float towardLight = fogCoverRelief(top + normalize(light.xz + vec2(1e-4)) * FOG_COVER_SHADOW_STEP);
  float shadow = 1.0 - 0.3 * smoothstep(0.02, 0.12, towardLight - relief);
  float diffuse = clamp((dot(normal, light) + 0.4) / 1.4, 0.0, 1.0) * shadow;
  float hollow = mix(0.92, 1.06, smoothstep(0.3, 0.75, relief));
  vec3 lightHue = uSunColor / max(max(uSunColor.r, max(uSunColor.g, uSunColor.b)), 0.05);
  vec3 sunlit = FOG_COVER_SUN * mix(vec3(1.0), lightHue, FOG_COVER_TINT);
  // Relative to a level cover top: the mean brightness stays the flat cover's (readability).
  vec3 level = FOG_COVER_AMBIENT + sunlit * clamp((light.y + 0.4) / 1.4, 0.0, 1.0);
  vec3 shade = FOG_COVER_GAIN * (FOG_COVER_AMBIENT + sunlit * diffuse) / level;
  return fogCoverColor(fogCoverPuffs(top)) * mix(vec3(1.0), hollow * shade, 1.0 - 0.6 * uRain);
}
`;

export const FOG_OF_WAR_GLSL = `
${ATMOSPHERE_GLSL}
${CONCEALMENT_GLSL}
${ATMOSPHERE_VIEW_LIMIT_GLSL}
${FOG_VISIBILITY_FADE_GLSL}
${LIT_FOG_COVER_GLSL}
const float FOG_CLEAR_VISIBILITY = ${FOG_CLEAR_VISIBILITY.toFixed(2)};
/**
 * Ordinary view: visibility 1 visible, 0.5 discovered (desaturated), 0 hidden (drifting light
 * cloud cover). Walking keeps near surfaces clear; the separate 3D concealment veil is
 * composed by the shared colour output, alongside weather atmosphere.
 */
vec3 applyFogClouds(vec3 color, float visibility, vec2 xz) {
  if (uExplorationFog >= 1.0) return color;
  vec3 revealed = color;
  visibility=sampleLiveFog(visibility,xz);
  if (visibility >= FOG_CLEAR_VISIBILITY) return color;
  float grey = dot(color, vec3(0.3, 0.59, 0.11));
  float discovered = 1.0 - smoothstep(0.55, FOG_CLEAR_VISIBILITY, visibility);
  color = mix(color, vec3(grey) * 0.82 + vec3(0.02, 0.03, 0.06), discovered * 0.5);
  float drift = fbm3(xz * 0.09 + vec2(uTime * 0.04, uTime * 0.015)) - 0.5;
  float hidden = 1.0 - fogVisibilityFade(visibility + drift * 0.35);
  float puffs = fbm3(xz * 0.05 - vec2(uTime * 0.025, 0.0));
  vec3 cloud = fogCoverColor(puffs);
  // Only hidden pixels pay for the lit relief (explicit-LOD fetches: valid in this branch).
  if (uFogOfWarLit > 0.5 && hidden > 0.004) cloud = litFogCover(puffs, xz);
  return mix(mix(color, cloud, hidden * 0.96), revealed, uExplorationFog);
}

/**
 * Optical depth of the separate weather and exploration veil between the eye and a surface; the
 * shared colour output (color-output-glsl.ts) composes it once, in linear light.
 */
float atmosphereSurfaceTau(vec3 worldPosition) {
  if (uAtmospherePass < 0.5 ||
      (uAtmosphereProfile.x <= 0.0 && uExplorationFog <= 0.0 && uAtmosphereBankParams.w < 0.5))
    return 0.0;
  AtmosphereRay ray = atmosphereSurfaceRay(worldPosition);
  return atmosphereOpticalDepth(ray) + concealmentOpticalDepth(ray)
    + atmosphereViewLimitOpticalDepth(worldPosition);
}

/** Deep sea haze the open sea beyond the map fades into, far out. */
const vec3 FAR_SEA_HAZE = vec3(${FAR_SEA_HAZE.map(glslLiteral).join(", ")});

/**
 * The playable border reads as a soft darker band over the last cells inside the map; beyond it
 * the open sea stays visible and fades into a deep haze far out (no black wall at the edge).
 */
vec3 applyMapEdge(vec3 color, vec2 xz) {
  if (uWorldSize.x <= 0.0) return color;
  vec2 beyond = max(-xz, xz - uWorldSize);
  float outside = max(max(beyond.x, beyond.y), 0.0);
  vec3 bordered = color * mix(0.72, 1.0, getMapInterior(xz));
  return mix(bordered, FAR_SEA_HAZE, smoothstep(4.0, 60.0, outside) * 0.85);
}

vec3 applyFogOfWar(vec3 color, float visibility, vec2 xz) {
  return applyMapEdge(applyFogClouds(color, visibility, xz), xz);
}
`;

/** A number as a GLSL float literal with one decimal (`2` -> `2.0`). */
export const glslFloat = (value: number) => value.toFixed(1);

/** GLSL: a vector turned about +Y by `heading` (radians), for instanced units and critters. */
export const HEADING_TURN_GLSL = `vec3 turn(vec3 value, float heading) {
  float c = cos(heading);
  float s = sin(heading);
  return vec3(value.x * c - value.z * s, value.y, value.x * s + value.z * c);
}
`;
