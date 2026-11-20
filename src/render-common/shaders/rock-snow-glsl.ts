import { PREVAILING_WIND_DIRECTION } from "../../shared/world/prevailing-wind";
import { SNOW_MAP_GLSL } from "../snow-map";
import { SNOW_PALETTE_GLSL } from "../snow-palette";
import { glslLiteral } from "./glsl-literal";
import { ROCK_SNOW_LINE, ROCK_WINTER_SNOW_LINE_DROP } from "./rock-tuning";

/**
 * Snow on the rock (needs NOISE_GLSL): it lies only on gentle upward surfaces above the snow
 * line (the ground's peak snow band and the winter snow map), drifts on lee faces and in
 * hollows, and breaks up at its edge so rock shows through. The snow surface is soft (its
 * normal leans up, hiding the mesh facets) and never flat white: wind ripples, drifts,
 * cool lee faces.
 */
export const ROCK_SNOW_GLSL = `
${SNOW_MAP_GLSL}
/** Prevailing wind (the way it blows, as the ground's): lee faces collect drifts. */
const vec2 SNOW_WIND = vec2(${PREVAILING_WIND_DIRECTION.x.toFixed(4)}, ${PREVAILING_WIND_DIRECTION.z.toFixed(4)});
/**
 * Snow line (world height): at the top of the snow ground band (7 .. 7.8), so rock never carries
 * snow where the ground around it has none (low outcrops beside forest stay bare).
 */
const float SNOW_LINE = ${glslLiteral(ROCK_SNOW_LINE)};
/** How far the snow line comes down in a fully snowy (winter theme) area: to the lowland. */
const float WINTER_SNOW_LINE_DROP = ${ROCK_WINTER_SNOW_LINE_DROP.toFixed(2)};

/** Snow line here: lower where the theme brings winter (the snow map). */
float getRockSnowLine(vec3 world) {
  if (world.y < SNOW_LINE - WINTER_SNOW_LINE_DROP - 1.0) return SNOW_LINE;
  return SNOW_LINE - getSnowMap(world.xz) * WINTER_SNOW_LINE_DROP;
}

/** Lee exposure -1 (windward) .. 1 (lee) of a sloped face. */
float getSnowLee(vec3 normal) {
  return dot(normalize(normal.xz + vec2(1e-4)), SNOW_WIND) * (1.0 - normal.y);
}

/**
 * Snow cover 0..1. Lying snow needs a gentle upward face (about 35 degrees or flatter); lee faces
 * and hollows hold it a little steeper, windward faces less. Macro patches (patches 0..1) and the
 * stone (rock ridges poke through, weathered rock holds it) break the edge, which is a short
 * speckled transition (the stone texture) with rock showing through; just below the threshold
 * snow lies only in specks.
 */
float getSnowCover(vec3 world, vec3 normal, vec4 mask, vec4 materials, vec2 patches) {
  float lee = getSnowLee(normal);
  float line = getRockSnowLine(world) + (patches.x - 0.5) * 1.2 - lee * 0.3;
  float altitude = smoothstep(line - 0.12, line + 0.45, world.y);
  if (altitude <= 0.0) return 0.0;
  float stone = (materials.g - materials.r) * 0.35;
  float hold = normal.y + (patches.x - 0.5) * 0.22 + lee * 0.14 + mask.w * 0.06 + stone;
  float lying = smoothstep(0.72, 0.94, hold + (patches.y - 0.5) * 0.25);
  float edge = lying * (1.0 - lying) * 4.0;
  float speckle = (materials.g - 0.5) * 1.4 + (materials.b - 0.5) * 0.6;
  float cover = smoothstep(0.3, 0.7, lying + speckle * edge * 0.9);
  float specks = smoothstep(0.56, 0.68, materials.g + (patches.y - 0.5) * 0.5);
  float dusting = smoothstep(0.65, 0.84, hold) * specks;
  return altitude * max(cover, dusting * 0.5);
}

/** Snow surface normal: leans up (snow softens the form and hides the facets beneath). */
vec3 getSnowNormal(vec3 normal) {
  return normalize(normal + vec3(0.0, 0.35, 0.0));
}

/**
 * Snow albedo: below pure white (as the ground's snow); wind ripples across the drift
 * direction, brighter drifts, cool blue on lee faces and where the snow turns from the sky.
 */
vec3 getSnowColor(vec3 world, vec3 normal, vec2 patches) {
  float warp = (patches.x - 0.5) * 6.0 + (patches.y - 0.5) * 4.0;
  float ripples = sin(dot(world.xz, SNOW_WIND) * 3.1 + world.y * 0.8 + warp) * 0.5 + 0.5;
  float tone = 0.54 + smoothstep(0.4, 0.7, patches.y) * 0.05 - ripples * 0.035;
  float lee = clamp(getSnowLee(normal) * 2.0, 0.0, 1.0);
  float turned = 1.0 - smoothstep(0.75, 0.98, normal.y);
  return vec3(tone) * mix(vec3(1.0), ${SNOW_PALETTE_GLSL.rockLee}, max(lee * 0.6, turned * 0.7));
}
`;
