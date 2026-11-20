/**
 * Water shading: clear turquoise shallows with a visible, caustic lit
 * seabed, deep blue further out, surf foam, glints at a low sun). The caller provides the
 * seabed colour from the refraction texture (without refraction, Minimal, it blends
 * shadeWaterLayer over the seabed it already drew).
 *
 * One wave model drives everything (R18a): the swell lifts the mesh and tilts the normals, the
 * wind ripples scroll with its two main trains; the surf rolls in on its own, longer period
 * (SURF_TIMING) and the beach run-up follows the same surf phase.
 */
import { PREVAILING_WIND_DIRECTION } from "../../shared/world/prevailing-wind";
import { FOAM_GLARE_FLOOR } from "../highlights";
import { glslLiteral } from "./glsl-literal";
import { SEASON_ICE_GLSL } from "./season-ground-glsl";
import { SEASON_UNIFORM_GLSL } from "./season-uniform-glsl";

const WIND_X = PREVAILING_WIND_DIRECTION.x.toFixed(4);
const WIND_Z = PREVAILING_WIND_DIRECTION.z.toFixed(4);

/** The three Gerstner-like trains shared by the GLSL and the TSL water twin. */
export const WATER_WAVE_TRAINS = [
  {
    amplitude: 0.07,
    direction: [PREVAILING_WIND_DIRECTION.x, PREVAILING_WIND_DIRECTION.z] as const,
    frequency: 0.55,
    speed: 1.1
  },
  { amplitude: 0.04, direction: [-0.5, 0.85] as const, frequency: 0.9, speed: 1.5 },
  { amplitude: 0.02, direction: [0.2, -0.98] as const, frequency: 1.4, speed: 2.1 }
] as const;

/**
 * Surf and swash timing, shared by the GLSL and the TSL water/terrain twins. Measured with the TOOL-8
 * reference tuner on the owner's static beach clips (receipt docs/plans/ref-tuner-2026-11-17.md): real
 * swash cycles took 8–15 s with a 5 s run-up, where the main swell's 5.7 s period made the sheet flicker
 * up the sand in 1.7 s. The surf now rolls in on its own period; its fronts keep the swell's shoreward
 * speed (wave number scaled with the angular speed), so they stand further apart.
 */
export const MONSOON_RIPPLE = 0.08;

export const SURF_TIMING = {
  /** Angular speed of the surf (rad/s): period 2π / 0.7 ≈ 9 s. */
  speed: 0.7,
  /** Surf fronts per unit of coast distance (about six cells apart). */
  waveNumber: 1.0,
  /** Surf cycle share the swash runs up the beach after a front arrives (≈ 3.1 s)... */
  uprush: 0.35,
  /** ...and the share it drains back (≈ 4 s); the rest it lies at its lowest run-up (≈ 1.8 s). */
  backwash: 0.45
} as const;

/**
 * Gerstner-like swell, a function of world position and time only. The water vertex shader lifts
 * the mesh with it (faded to flat at the map border, where the coarse open sea frame starts); the
 * fragment shader takes the slope per pixel, so the waves light the same in the map and beyond
 * it, in phase across the border. The main train runs with the prevailing wind.
 */
export const WATER_SWELL_GLSL = `
const vec3 WAVE_A = vec3(${WIND_X}, ${WIND_Z}, ${WATER_WAVE_TRAINS[0].frequency});
const vec3 WAVE_B = vec3(${WATER_WAVE_TRAINS[1].direction[0]}, ${WATER_WAVE_TRAINS[1].direction[1]}, ${WATER_WAVE_TRAINS[1].frequency});
const vec3 WAVE_C = vec3(${WATER_WAVE_TRAINS[2].direction[0]}, ${WATER_WAVE_TRAINS[2].direction[1]}, ${WATER_WAVE_TRAINS[2].frequency});
/** Angular speed of the main train (the surf has its own period: SURF_TIMING). */
const float WAVE_A_SPEED = ${WATER_WAVE_TRAINS[0].speed};

vec3 swellWave(vec3 settings, float amplitude, float speed, vec2 p, float time) {
  float phase = settings.z * dot(settings.xy, p) + time * speed;
  return vec3(sin(phase), settings.xy * settings.z * cos(phase)) * amplitude;
}

/** x: swell height, yz: its slope. */
vec3 getSwell(vec2 p, float time) {
  return swellWave(WAVE_A, ${WATER_WAVE_TRAINS[0].amplitude}, WAVE_A_SPEED, p, time) + swellWave(WAVE_B, ${WATER_WAVE_TRAINS[1].amplitude}, ${WATER_WAVE_TRAINS[1].speed}, p, time)
    + swellWave(WAVE_C, ${WATER_WAVE_TRAINS[2].amplitude}, ${WATER_WAVE_TRAINS[2].speed}, p, time);
}

/** Calm near the shore and on rivers. */
float getSwellCalm(float depth, vec2 flow) {
  return smoothstep(0.4, 2.5, depth) * (1.0 - smoothstep(0.01, 0.2, length(flow)));
}

/**
 * Share of the swell slope in the normals: the geometry's calm, but the shallows keep a gentle
 * part of the same waves (shoaling towards the surf); rivers stay flat.
 */
float getSwellSlopeWeight(float depth, vec2 flow) {
  return mix(0.35, 1.0, smoothstep(0.4, 2.5, depth)) * (1.0 - smoothstep(0.01, 0.2, length(flow)));
}
`;

/**
 * Foam shared by the surf and the ship wakes (needs NOISE_GLSL): its colour, a lacy pattern and
 * an age dissolve.
 */
export const WATER_FOAM_COLOR = [0.94, 0.97, 1.0] as const;

export const WATER_FOAM_GLSL = `
const vec3 FOAM_COLOR = vec3(${WATER_FOAM_COLOR.map(value => glslLiteral(value)).join(", ")});
const float FOAM_GLARE_FLOOR = ${FOAM_GLARE_FLOOR.toFixed(2)};

/** Foam brightness share of the Highlights / glare setting: FOAM_GLARE_FLOOR at 0, unchanged at 1. */
float foamGlare() {
  return mix(FOAM_GLARE_FLOOR, 1.0, uHighlight);
}

/**
 * Lacy foam pattern in [0, 1]: two rotated noise octaves at unrelated scales (no visible tiling),
 * slowly drifting. WATER_FOAM_LITE (Low, Minimal) keeps one octave.
 */
float foamLace(vec2 xz, float time) {
  vec2 p = xz * 1.7;
  float coarse = valueNoise(p + vec2(time * 0.21, time * 0.13));
#ifdef WATER_FOAM_LITE
  return coarse;
#else
  float fine = valueNoise(mat2(0.8, -0.6, 0.6, 0.8) * p * 2.3 - vec2(time * 0.17, -time * 0.11) + 19.3);
  return coarse * 0.6 + fine * 0.4;
#endif
}

/** Foam that thins with age: fresh foam (age 0) is a dense sheet, older foam dissolves into lace. */
float dissolveFoam(float lace, float age) {
  return smoothstep(age, age + 0.16, lace);
}
`;

export const WATER_PALETTES = {
  normal: { absorption: [0.5, 0.1, 0.075], deep: [0.025, 0.15, 0.31], shallow: [0.1, 0.56, 0.58] },
  winter: { absorption: [0.52, 0.14, 0.075], deep: [0.018, 0.115, 0.29], shallow: [0.055, 0.34, 0.46] }
} as const;

/** Where the refracted sun ray entered the water above a submerged point (common uniforms). */
export const REFRACTED_SUN_GLSL = `
/** Horizontal offset per unit depth from a bed point to where its refracted sun ray entered. */
vec2 refractedSunOffset() {
  vec2 across = uSunDirection.xz / 1.333;
  return across / sqrt(max(1.0 - dot(across, across), 0.05));
}
`;

/**
 * Sunlight under the surface (needs the noise and common uniforms): the caustic light pattern and
 * the refracted sun ray. Shared by the seabed and the underwater fish (fish-schools).
 */
export const CAUSTICS_GLSL = `
${REFRACTED_SUN_GLSL}
/** Bright wavy light lines on the shallow seabed. */
float caustics(vec2 xz, float time) {
  vec2 q = xz * 0.85;
  float light = 0.0;
  for (int layer = 0; layer < 2; layer++) {
    vec2 warp = vec2(valueNoise(q + time * 0.3), valueNoise(q.yx - time * 0.25 + 7.0));
    float value = valueNoise(q * 2.2 + warp * 2.0);
    light += pow(1.0 - abs(value * 2.0 - 1.0), 7.0);
    q = q * 1.7 + 3.1;
  }
  return light * 0.6;
}

`;

const toGlslVec3 = (values: readonly number[]) => `vec3(${values.join(", ")})`;

/**
 * Season changes only three colours; the water equations and samples stay identical. The prepared
 * (fallback) winter compiles the full winter palette; otherwise the palette follows the global
 * season's ice ramp (getSeasonIce, seasons-6) through a uniform, so it blends without a rebuild and
 * summer (ramp 0) keeps the summer colours exactly.
 */
export const createWaterGlsl = (winter = false) => {
  const { normal, winter: frozen } = WATER_PALETTES;
  return `
${SEASON_ICE_GLSL}
const vec3 WATER_ABSORPTION_SUMMER = ${toGlslVec3(normal.absorption)};
const vec3 WATER_ABSORPTION_WINTER = ${toGlslVec3(frozen.absorption)};
const vec3 WATER_SCATTER_SHALLOW_SUMMER = ${toGlslVec3(normal.shallow)};
const vec3 WATER_SCATTER_SHALLOW_WINTER = ${toGlslVec3(frozen.shallow)};
const vec3 WATER_SCATTER_DEEP_SUMMER = ${toGlslVec3(normal.deep)};
const vec3 WATER_SCATTER_DEEP_WINTER = ${toGlslVec3(frozen.deep)};

/** Share of the winter water palette: full in the prepared winter, else the season ice ramp. */
float getWinterWaterShare() {
  return ${winter ? "1.0" : "getSeasonIce()"};
}
const vec3 WEED_TINT = vec3(0.38, 0.58, 0.26);
const float TWO_PI = 6.2831853;
/** Surf fronts per unit of coast distance and the surf's angular speed (SURF_TIMING). */
const float SURF_WAVE_NUMBER = ${glslLiteral(SURF_TIMING.waveNumber)};
const float SURF_SPEED = ${glslLiteral(SURF_TIMING.speed)};
${WATER_SWELL_GLSL}
${WATER_FOAM_GLSL}

uniform sampler2D uWaterNormals;
${SEASON_UNIFORM_GLSL}
/** Monsoon (uSeason.w): a slightly rougher sea under the stronger wind (M1, cosmetic). */
const float MONSOON_RIPPLE = ${MONSOON_RIPPLE.toFixed(2)};
/** Glint colour (shader-uniforms.ts): the sun disc's hue by day, the tinted moonlight at night. */
uniform vec3 uSunGlint;

/**
 * Raindrop rings: at most one drop per small cell and cycle, random timing. Drops differ in size,
 * about a third of the cells stay calm each cycle, and every ring is slightly out of round and
 * fades fast, so the surface never shows a regular grid of perfect circles.
 */
vec2 rainRings(vec2 p, float time) {
  vec2 scaled = p * 1.6;
  vec2 cell = floor(scaled);
  float seed = texture(uNoiseTexture, (cell + 0.5) / 211.0).g;
  vec2 offset = fract(scaled) - 0.5 - (vec2(seed, fract(seed * 7.3)) - 0.5) * 0.5;
  float cycle = time * 0.8 + seed * 9.0;
  float age = fract(cycle);
  float live = step(0.33, fract(seed * 13.7 + floor(cycle) * 0.618));
  float reach = 0.3 + fract(seed * 31.1) * 0.22;
  float distance = length(offset);
  vec2 direction = offset / max(distance, 0.001);
  float wobble = 1.0 + 0.13 * sin(dot(direction, vec2(3.1, 1.7)) * 2.0 + seed * 40.0);
  float radius = age * reach * wobble;
  float ring = sin((distance - radius) * 55.0) * smoothstep(0.06, 0.0, abs(distance - radius));
  float fade = (1.0 - age) * (1.0 - age);
  return direction * ring * fade * live * 1.1;
}

/**
 * Wind ripple slope: two scrolling tileable ripple normal maps, each drifting with one of the two
 * main swell trains (the swell itself is added by the caller, weighted like the geometry).
 */
vec2 rippleSlope(vec2 p, float time) {
  vec2 a = texture(uWaterNormals, p * 0.11 + WAVE_A.xy * (time * 0.0117)).rg * 2.0 - 1.0;
  vec2 b = texture(uWaterNormals, p * 0.23 + WAVE_B.xy * (time * 0.0167)).ba * 2.0 - 1.0;
  vec2 rain = uRain > 0.01 ? rainRings(p, time) * uRain : vec2(0.0);
  return (a + b * 0.6) * (0.22 + uRain * 0.12 + uSeason.w * MONSOON_RIPPLE) + rain;
}

/** Water normal; rivers advect the ripples along the flow (two phase flow map). */
vec3 waterNormal(vec2 xz, vec2 flow, float time) {
  // Sea and lakes have no phase reset to hide: avoid evaluating the unused second phase.
  if (length(flow) <= 0.01) {
    vec2 slope = rippleSlope(xz, time);
    return normalize(vec3(slope.x, 1.0, slope.y));
  }
  float phaseA = fract(time * 0.4);
  float phaseB = fract(time * 0.4 + 0.5);
  vec2 offsetA = flow * phaseA * 2.0;
  vec2 offsetB = flow * phaseB * 2.0;
  float mixB = abs(phaseA - 0.5) * 2.0;
  vec2 slope = mix(rippleSlope(xz - offsetA, time), rippleSlope(xz - offsetB + 13.7, time), mixB);
  return normalize(vec3(slope.x, 1.0, slope.y));
}

/**
 * Phase (radians) of the surf rolling in: shore-parallel fronts (along the coast distance) that
 * arrive with the surf period (SURF_TIMING), bent by a smooth analytic warp. No texture fetch, so the
 * beach run-up of the ground shader and the water's foam share it exactly.
 */
float surfPhase(vec2 xz, float coast, float time) {
  float warp = sin(dot(xz, vec2(0.23, 0.11))) + 0.6 * sin(dot(xz, vec2(-0.09, 0.31)) + 1.7);
  return coast * SURF_WAVE_NUMBER - time * SURF_SPEED + warp * 1.4;
}

/** Age of the surf at a point: 0 just behind a breaking front, rising to 1 when the next arrives. */
float surfAge(vec2 xz, float coast, float time) {
  return 1.0 - fract(surfPhase(xz, coast, time) / TWO_PI);
}

/**
 * Strength of the surf at a point: full just behind a front, fading to 0 by the next one; the
 * front itself ramps in over a short stretch, so the pattern stays continuous (no aliased edge).
 */
float surfFreshness(float age) {
  return (1.0 - age) * smoothstep(0.0, 0.06, age);
}

/** Lowest swash run-up and the extra a fresh front adds (water depth units above the water). */
const float SWASH_BASE = 0.04;
const float SWASH_RISE = 0.24;

/** Surf cycle share the swash runs up the beach after a front arrives, and the share it drains back. */
const float SWASH_UPRUSH = ${glslLiteral(SURF_TIMING.uprush)};
const float SWASH_BACKWASH = ${glslLiteral(SURF_TIMING.backwash)};

/**
 * Swash reach 0..1 at a surf age: the sheet runs up decelerating after the front arrives, drains
 * back accelerating, then rests at the lowest run-up until the next front (ballistic swash).
 */
float swashReach(float age) {
  if (age < SWASH_UPRUSH) {
    float rising = 1.0 - age / SWASH_UPRUSH;
    return 1.0 - rising * rising;
  }
  float draining = min((age - SWASH_UPRUSH) / SWASH_BACKWASH, 1.0);
  return 1.0 - draining * draining;
}

/** Height the swash sheet reaches up the beach at a surf age (shore-wetness-glsl.ts). */
float swashRunUp(float age) {
  return SWASH_BASE + SWASH_RISE * swashReach(age);
}

${CAUSTICS_GLSL}
/**
 * Caustics on the shallow bed under the water (the wet sand above it is ground wetness, applied
 * before lighting: shore-wetness-glsl.ts). The caustics are the surface pattern where the refracted
 * sun ray entered, so they shift with the sun; they need direct sun (the bed's shadow and cloud
 * visibility) and a high sun.
 */
vec3 waterlineGround(vec3 lit, float signedDepth, vec2 xz, float time, float sunVisibility) {
  float depth = max(signedDepth, 0.0);
  float shallow = exp(-depth * 0.9) * smoothstep(0.0, 0.12, depth);
  if (shallow <= 0.0) return lit;
  vec2 entry = xz + refractedSunOffset() * depth;
  float sunLight = sunVisibility * cloudShadow(entry) * smoothstep(0.04, 0.3, uSunDirection.y);
  return lit + caustics(entry, time) * uSunColor * 0.32 * shallow * sunLight;
}

/** Glints only for a low sun (dawn, dusk): none below the horizon, none in daylight. */
float glintSunWeight() {
  float height = uSunDirection.y;
  return smoothstep(0.02, 0.1, height) * (1.0 - smoothstep(0.22, 0.42, height));
}

/** Low sun glints on the ripples; the peak rolls off to a warm tint instead of clipping to white. */
vec3 sunGlint(vec3 normal, float clouds, vec3 viewDirection) {
  float weight = glintSunWeight();
  if (weight <= 0.0) return vec3(0.0);
  float alignment = max(dot(normal, normalize(uSunDirection + viewDirection)), 0.0);
  float glint = pow(alignment, 220.0) * 2.2 * weight * clouds;
  return uSunGlint * (0.8 * glint / (0.4 + glint)) * uHighlight;
}

/**
 * Daytime sun specular on the waves (R05): the lobe widens with the wave normals' screen-space
 * variance (distant or choppy water reads as a soft sheen instead of aliasing sparkles) and with
 * rain ripples; the peak rolls off like the low-sun glint.
 */
vec3 daySunGlint(vec3 normal, float clouds, vec3 viewDirection) {
  vec3 variance = fwidth(normal);
  float weight = smoothstep(0.18, 0.4, uSunDirection.y) * (1.0 - uCloudCover * 0.7);
  if (weight <= 0.0) return vec3(0.0);
  float spread = 1.0 + 40.0 * (variance.x + variance.y + variance.z);
  float sharpness = mix(320.0, 90.0, uRain) / spread;
  float alignment = max(dot(normal, normalize(uSunDirection + viewDirection)), 0.0);
  float glint = pow(alignment, sharpness) * 1.6 * weight * clouds / spread;
  return uSunGlint * (0.7 * glint / (0.5 + glint)) * uHighlight;
}

/**
 * Where a front breaks along its length: slowly wandering sections (analytic, no fetch), so the
 * outer surf reads as broken white lines instead of a continuous band.
 */
float surfSections(vec2 xz, float time) {
  float along = sin(dot(xz, vec2(0.29, -0.21)) + time * 0.23);
  float across = sin(dot(xz, vec2(-0.17, -0.33)) * 1.3 + 2.1 - time * 0.17);
  return smoothstep(-0.25, 0.75, along * 0.6 + across * 0.4);
}

/**
 * Surf foam: every front breaks in sections a few cells out and leaves a foam sheet behind it that
 * dissolves into lace as it ages. It fades out over the last cell before the waterline, where the
 * swash sheet (shore-wetness-glsl.ts) takes the front's foam up the beach as its single edge line, so
 * the sea never shows a second, standing foam band at the water's edge. Water with current (rivers)
 * keeps a thin edge line at the waterline (at most .18 deep: settlement-fishing.ts casts past it).
 */
float shoreFoam(vec2 xz, float coast, float depth, float time, float sea) {
  float age = surfAge(xz, coast, time);
  float lace = foamLace(xz, time);
  float surfZone = smoothstep(-6.0, -2.0, coast) * (1.0 - smoothstep(-1.0, -0.15, coast)) * sea;
  float fresh = surfFreshness(age);
  float surf = dissolveFoam(lace, 0.3 + age * 1.1) * fresh * surfZone * surfSections(xz, time);
  if (sea >= 1.0) return clamp(surf * 0.9, 0.0, 1.0);
  float swash = 1.0 - smoothstep(0.02, 0.07 + 0.11 * fresh * fresh, depth);
  float edge = swash * dissolveFoam(lace, 0.12 + 0.45 * age) * (1.0 - sea);
  return clamp(max(surf, edge) * 0.9, 0.0, 1.0);
}

/**
 * Underwater weed beds on the seabed of calm fresh water: dark green clumps streaked along the
 * current, the streaks swaying with it; laid softer under the real weed strands (strength).
 */
vec3 weedBed(vec3 bed, vec2 xz, float plants, float depth, vec2 flow, float time, float strength) {
  float grow = smoothstep(0.35, 0.75, plants) * smoothstep(0.16, 0.32, depth);
  if (grow <= 0.0) return bed;
  vec2 along = length(flow) > 0.01 ? normalize(flow) : vec2(${WIND_X}, ${WIND_Z});
  vec2 local = vec2(dot(xz, along), dot(xz, vec2(-along.y, along.x)));
  float sway = sin(time * 1.3 + local.x * 1.7) * 0.08;
  float clumps = smoothstep(0.42, 0.66, valueNoise(xz * 1.2 + 11.0));
  float strands = valueNoise(vec2(local.x * 2.0 - time * 0.2, (local.y + sway) * 11.0));
  float weed = clumps * grow * (0.5 + 0.5 * strands) * strength;
  return mix(bed, bed * WEED_TINT, weed);
}

/**
 * Share of the surface the foam covers (surf, swash and fast river water), 0..0.8; also the share
 * the screen-space reflection (R18b) leaves out, since foam does not mirror.
 */
float waterFoamCover(vec2 xz, float depth, float coast, vec2 flow, float time) {
  float speed = length(flow);
  float riverFoam = smoothstep(1.1, 2.2, speed) * smoothstep(0.45, 0.8, valueNoise((xz - flow * time) * 2.2));
  float sea = 1.0 - smoothstep(0.02, 0.2, speed);
  float foam = max(shoreFoam(xz, coast, depth, time, sea), riverFoam) * smoothstep(0.0, 0.03, depth);
  return foam * 0.8;
}

/**
 * Brightness a full sun shadow leaves on the water surface: 0.55 over shallows (a lit sand bed
 * dominates), 0.75 over deep water (body scatter and sky reflection dominate).
 */
float waterShadowFloor(float depth) {
  return mix(0.55, 0.75, smoothstep(0.3, 2.5, depth));
}

/** Water over a seabed: final colour = color + bed * transmit (linear in the bed colour). */
struct WaterLayer {
  vec3 color;
  vec3 transmit;
};

/** Schlick air/water reflectance (IOR 1.333): reflection takes its share of transmission. */
float waterFresnel(float cosTheta) {
  float facing = 1.0 - clamp(cosTheta, 0.0, 1.0);
  float facing2 = facing * facing;
  return 0.0204 + 0.9796 * facing2 * facing2 * facing;
}

/**
 * The water without its seabed: absorption of the bed by depth (red first, so shallows turn
 * turquoise), in-scattered water colour, sky reflection, glints and foam. Three without
 * refraction blends it over the seabed already drawn.
 */
WaterLayer shadeWaterLayer(
  vec2 xz, float signedDepth, float coast, vec2 flow, float time, vec3 normal, vec3 viewDirection
) {
  float depth = max(signedDepth, 0.0);
  vec3 lightTint = uSunColor * 0.6 + uAmbientSky * 0.6;
  float winterShare = getWinterWaterShare();
  vec3 scatterShallow = mix(WATER_SCATTER_SHALLOW_SUMMER, WATER_SCATTER_SHALLOW_WINTER, winterShare);
  vec3 scatterDeep = mix(WATER_SCATTER_DEEP_SUMMER, WATER_SCATTER_DEEP_WINTER, winterShare);
  vec3 absorption = mix(WATER_ABSORPTION_SUMMER, WATER_ABSORPTION_WINTER, winterShare);
  vec3 scatter = mix(scatterShallow, scatterDeep, smoothstep(1.0, 5.5, depth)) * lightTint;
  float clouds = cloudShadow(xz);
  float light = (0.65 + 0.45 * max(dot(normal, uSunDirection), 0.0)) * clouds;
  float scattered = 1.0 - exp(-depth * 0.4);
  vec3 color = scatter * light * scattered;
  vec3 transmit = exp(-depth * absorption) * (1.0 - scattered);
  float reflection = waterFresnel(dot(normal, viewDirection));
  // The shared SH9 sky in the mirror direction (R05): zenith blue from above, the pale and, at
  // low sun, warm horizon at grazing angles. The set is mirrored below the horizon, so a wave
  // normal tilted past it still reflects sky.
  vec3 sky = skyReflection(reflect(-viewDirection, normal));
  color = color * (1.0 - reflection) + sky * reflection + sunGlint(normal, clouds, viewDirection)
    + daySunGlint(normal, clouds, viewDirection);
  transmit *= 1.0 - reflection;
  float foamCover = waterFoamCover(xz, depth, coast, flow, time);
  color = mix(color, FOAM_COLOR * lightTint * (0.75 + 0.25 * light) * foamGlare(), foamCover);
  transmit *= 1.0 - foamCover;
  float surface = smoothstep(0.0, 0.04, depth);
  return WaterLayer(color * surface, transmit * surface + (1.0 - surface));
}

/** Final water colour over the given seabed colour. */
vec3 shadeWater(
  vec2 xz, float signedDepth, float coast, vec2 flow, float time, vec3 normal, vec3 viewDirection, vec3 bed
) {
  WaterLayer water = shadeWaterLayer(xz, signedDepth, coast, flow, time, normal, viewDirection);
  return water.color + bed * water.transmit;
}
`;
};

export const WATER_GLSL = createWaterGlsl();
