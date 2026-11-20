import { ORE_CODES } from "./rock-tuning";

/**
 * Mine ground extras (needs the common uniforms and NOISE_GLSL; used by GROUND_GLSL).
 * - Ore stain: once a zone is surveyed its mine gravel takes a faint, patchy tint of the ore
 *   (coal dust, rust, warm quartz, pale granite).
 * - Glints: sparse mineral glints twinkle on mine ground (each glint cell has its own phase and
 *   period, a short sun coloured flash that shifts with the camera, with a small star streak).
 *   Neutral mica white before a survey, the ore's colour after; denser on rich ground, none once
 *   mined out; dimmed in rain and in shadow, faded out when a glint would shrink below a pixel.
 */
export const MINE_GLSL = `
const float MINE_GLINT_CELLS = 2.5;
const float MINE_GLINT_SHARE = 0.3;
const float MINE_GLINT_FLASH = 0.6;
const float MINE_GLINT_STRENGTH = 1.6;
const int ORE_COAL = ${ORE_CODES.coal};
const int ORE_IRON = ${ORE_CODES.iron};
const int ORE_GOLD = ${ORE_CODES.gold};
const int ORE_GRANITE = ${ORE_CODES.granite};

/** Multiplicative ore tint of the mine gravel (white: unsurveyed). */
vec3 getOreTint(int ore) {
  if (ore == ORE_COAL) return vec3(0.5, 0.49, 0.48);
  if (ore == ORE_IRON) return vec3(1.16, 0.8, 0.6);
  if (ore == ORE_GOLD) return vec3(1.1, 1.02, 0.82);
  if (ore == ORE_GRANITE) return vec3(1.08, 1.07, 1.04);
  return vec3(1.0);
}

/**
 * Faint patchy ore stain on the mine share of the ground (patchNoise: macro noise 0..1); it
 * fades in with the ore amount, so the deposit's edge is soft, not the cell outline.
 */
vec3 getOreStain(int ore, float mineShare, float oreAmount, float patchNoise) {
  if (ore == 0 || mineShare <= 0.0) return vec3(1.0);
  float fade = smoothstep(0.05, 0.6, oreAmount);
  float amount = mineShare * fade * (0.02 + 0.22 * smoothstep(0.58, 0.82, patchNoise));
  return mix(vec3(1.0), getOreTint(ore), amount);
}

vec3 getMineGlintColor(int ore) {
  if (ore == ORE_COAL) return vec3(0.62, 0.72, 0.95);
  if (ore == ORE_IRON) return vec3(0.6, 0.62, 0.66);
  if (ore == ORE_GOLD) return vec3(1.15, 0.86, 0.36);
  if (ore == ORE_GRANITE) return vec3(1.0, 1.0, 0.96);
  return vec3(0.92, 0.95, 1.0);
}

/** Share of glint cells that hold a glint, per ore (coal glints are rare, gold ones plenty). */
float getMineGlintDensity(int ore) {
  if (ore == ORE_COAL) return 0.4;
  if (ore == ORE_IRON) return 0.8;
  if (ore == ORE_GOLD) return 1.2;
  return 1.0;
}

/** 0..1 flash of a glint: a short sin^2 pulse once per period, at the glint's own phase. */
float getGlintFlash(float seed) {
  float period = 2.2 + fract(seed * 7.31) * 2.6;
  float local = mod(uTime + fract(seed * 13.7) * 10.0, period) / MINE_GLINT_FLASH;
  if (local >= 1.0) return 0.0;
  float pulse = sin(3.14159 * local);
  return pulse * pulse;
}

vec3 getMineGlint(float mine, int ore, float oreAmount, vec2 xz, float visibility) {
  if (mine <= 0.05) return vec3(0.0);
  vec2 scaled = xz * MINE_GLINT_CELLS;
  vec2 cell = floor(scaled);
  float seed = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
  float richness = oreAmount > 0.0 ? 0.35 + 0.65 * oreAmount : 0.0;
  if (seed > MINE_GLINT_SHARE * richness * getMineGlintDensity(ore)) return vec3(0.0);
  vec2 point = cell + 0.5 + (vec2(fract(seed * 91.7), fract(seed * 57.3)) - 0.5) * 0.6;
  vec2 offset = scaled - point;
  float pixel = max(fwidth(scaled.x), fwidth(scaled.y));
  float radius = max(0.07, pixel * 1.3);
  float spot = smoothstep(radius, 0.0, length(offset)) * smoothstep(0.7, 0.2, pixel);
  float view = valueNoise(point * 0.37 + uViewDirection.xz * 7.0);
  float flash = getGlintFlash(seed) * (0.55 + 0.9 * view);
  vec2 streak = abs(offset) / radius;
  float star = smoothstep(0.3, 0.0, min(streak.x, streak.y)) * smoothstep(3.5, 1.0, max(streak.x, streak.y));
  spot = max(spot, star * 0.7 * smoothstep(0.7, 0.2, pixel));
  float light = visibility * (1.0 - uRain * 0.75);
  return getMineGlintColor(ore) * uSunColor * spot * flash * mine * light * MINE_GLINT_STRENGTH;
}
`;
