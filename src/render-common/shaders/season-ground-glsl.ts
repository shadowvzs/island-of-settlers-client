import { SNOW_MAP_GLSL } from "../snow-map";
import { glslLiteral } from "./glsl-literal";

/** Monsoon mud on ordinary dirt (in patches) and the swamp/bank mud gain (GLSL and TSL). */
export const SEASON_MUD_TUNING = { bankGain: 0.8, dirt: 0.55, patch: [0.35, 0.7] } as const;

/**
 * Ground season uniforms (season-ground.ts, zero = summer, so a ground without them stays summer):
 * uSeasonMeadow rgb grass tint - 1, a dry-grass lean; uSeasonLitter rgb leaf litter tint - 1, a litter gain;
 * uSeasonCover x damp wetness, y mud, w global snow cover. Guarded: the ground, the tufts and the grass ring
 * may include it in one stage.
 */
export const SEASON_GROUND_UNIFORMS_GLSL = `
#ifndef SEASON_GROUND_UNIFORMS
#define SEASON_GROUND_UNIFORMS
uniform vec4 uSeasonMeadow;
uniform vec4 uSeasonLitter;
uniform vec4 uSeasonCover;
#endif
`;

/**
 * Season of the meadow tint (meadowTint): the dry-grass mask (sunny slopes and dry patches) leans to straw by
 * the season's lean, then the season tint multiplies the grass.
 */
export const SEASON_MEADOW_GLSL = `
${SEASON_GROUND_UNIFORMS_GLSL}
float getSeasonStraw(float straw, float sunny, float patchDry) {
  float mask = clamp(sunny + patchDry * 0.7 + 0.4, 0.0, 1.0);
  return mix(straw, 1.0, uSeasonMeadow.a * mask);
}

vec3 applySeasonMeadow(vec3 tint) {
  return tint * (1.0 + uSeasonMeadow.rgb);
}
`;

/**
 * Damp season ground (monsoon, spring thaw) through the bank wetness channel: below the film threshold, so it
 * darkens the soil without a gloss; banks and swamps get wetter in the monsoon. Not in the desert.
 */
export const SEASON_WETNESS_GLSL = `
float getSeasonWetness(float bank, float desert) {
  if (uSeasonCover.x <= 0.0) return bank;
  return max(bank * (1.0 + uSeasonCover.y * 0.6), uSeasonCover.x * (1.0 - desert));
}

/** Monsoon mud: fuller swamp and bank mud, and wet mud patches on ordinary dirt (not in the desert). */
float getSeasonMud(float mud, float dirt, float desert, vec2 xz) {
  if (uSeasonCover.y <= 0.0) return mud;
  float patches = smoothstep(${glslLiteral(SEASON_MUD_TUNING.patch[0])}, ${glslLiteral(SEASON_MUD_TUNING.patch[1])},
    getVariantNoise(xz * 0.3 + 41.0));
  float wet = dirt * uSeasonCover.y * ${glslLiteral(SEASON_MUD_TUNING.dirt)} * patches * (1.0 - desert);
  return max(mud * (1.0 + uSeasonCover.y * ${glslLiteral(SEASON_MUD_TUNING.bankGain)}), wet);
}
`;

/**
 * The possessed grass ring follows the tufts: the season meadow tint (tips first) and, while the global snow
 * builds, fewer blades (gone before the snow is half built; the winter rebuild drops the ring at mid-transition).
 */
export const SEASON_RING_GLSL = `
${SEASON_GROUND_UNIFORMS_GLSL}
vec3 getSeasonRingTint(float tip) {
  return 1.0 + uSeasonMeadow.rgb * mix(0.6, 1.0, tip);
}

float getSeasonRingKeep() {
  return 1.0 - smoothstep(0.05, 0.45, uSeasonCover.w);
}
`;

/**
 * Global winter snow on the GPU (T1, SEASON_SNOW; needs SNOW_MAP_GLSL and NOISE_GLSL): the season's cover ramp
 * (uSeasonCover.w) reaches each spot in a melt order from the snow keep (sheltered hollows and shade first, sunny
 * slopes last) broken by a noise, so the cover builds patch by patch and melts in reverse: sunny slopes and patch
 * edges first. The noise scale and the share of the noise in the order are shared with the TSL twin.
 */
export const SEASON_SNOW_TUNING = { band: 0.25, noiseScale: 0.23, orderNoise: 0.65 } as const;

export const SEASON_SNOW_GLSL = `
${SEASON_GROUND_UNIFORMS_GLSL}
#ifndef SEASON_SNOW_COVER
#define SEASON_SNOW_COVER
float getSeasonSnowCover(vec2 xz) {
  float ramp = uSeasonCover.w;
  if (ramp <= 0.0) return 0.0;
  if (ramp >= 1.0) return 1.0;
  float order = mix(1.0 - getSnowKeep(xz), valueNoise(xz * ${glslLiteral(SEASON_SNOW_TUNING.noiseScale)}),
    ${glslLiteral(SEASON_SNOW_TUNING.orderNoise)});
  float start = order * ${glslLiteral(1 - SEASON_SNOW_TUNING.band)};
  return smoothstep(start, start + ${glslLiteral(SEASON_SNOW_TUNING.band)}, ramp);
}

/**
 * Snow load of a prop or sprite: the area's theme snow, or the global season's cover where it is more; nothing
 * settles on props under the water (shells, sea weeds keep their look, like the old prepared winter allowlist).
 */
float getSeasonPropSnow(vec3 world, float winter) {
  return max(winter, getSeasonSnowCover(world.xz) * smoothstep(-0.02, 0.06, world.y));
}
#endif
`;

/**
 * Ice of the global winter (seasons-5): the frozen shore and the ice floes follow the snow ramp, forming after the first
 * snow has settled and melting with it, instead of switching at mid-transition.
 */
export const SEASON_ICE_RAMP = [0.3, 0.9] as const;

export const SEASON_ICE_GLSL = `
${SEASON_GROUND_UNIFORMS_GLSL}
#ifndef SEASON_ICE_SHARE
#define SEASON_ICE_SHARE
float getSeasonIce() {
  return smoothstep(${glslLiteral(SEASON_ICE_RAMP[0])}, ${glslLiteral(SEASON_ICE_RAMP[1])}, uSeasonCover.w);
}
#endif
`;

/**
 * Snow on the massif under the global season (seasons-5): the normal-y band of the (slope-exaggerated) terrain normal
 * over which snow holds on rock and mine ground; ledges and gentle rocky slopes take it, steep faces stay bare. The
 * real mine ground (not the apron of shed rock) takes a lighter load, so a quarry and its ore stain stay readable.
 * At most STONE_COVER of the stone moves, so its trace tells the snow keep redistribution to return snow to stone.
 */
export const SEASON_STONE_SNOW = { hold: [0.3, 0.6], mineLoad: 0.6, stoneCover: 0.995 } as const;

/**
 * The ground under the global snow (T1, main of both variants, before sampleGround): the exposed loose ground
 * (grass, clover, forest floor, dirt, sand, gravel; never the submerged beds) moves to the snow layer by the cover,
 * like the old prepared winter splat (winter-terrain.ts); rock and mine ground (gentle rocky slopes, ledges, the
 * apron and scree) follow the same ramp where the slope holds snow (seasons-5). Returns the cover.
 */
export const SEASON_SNOW_GROUND_GLSL = `
${SEASON_SNOW_GLSL}
${SEASON_ICE_GLSL}
float getSeasonStoneHold(vec3 normal) {
  return smoothstep(${glslLiteral(SEASON_STONE_SNOW.hold[0])}, ${glslLiteral(SEASON_STONE_SNOW.hold[1])},
    normal.y);
}

float coverSeasonSnow(inout vec4 splatA, inout vec4 splatB, inout vec4 splatC, vec2 xz, float waterDepth,
  vec3 normal, float apron) {
  float cover = getSeasonSnowCover(xz) * (1.0 - smoothstep(0.005, 0.025, waterDepth));
  if (cover <= 0.0) return 0.0;
  float stone = cover * getSeasonStoneHold(normal) * ${glslLiteral(SEASON_STONE_SNOW.stoneCover)};
  float rockMoved = splatB.y * stone;
  float mineMoved = splatC.x * stone * mix(${glslLiteral(SEASON_STONE_SNOW.mineLoad)}, 1.0, apron);
  float moved = dot(splatA, vec4(cover)) + (splatB.x + splatB.w) * cover + rockMoved + mineMoved;
  splatA *= 1.0 - cover;
  splatB.xw *= 1.0 - cover;
  splatB.y -= rockMoved;
  splatB.z += moved;
  splatC.x -= mineMoved;
  return cover;
}

/** The submerged shore under a frozen season: cool, greyed sand and soil (the old winter-shore.ts tint). */
void coolSeasonShore(inout vec3 albedo, float soil, float waterDepth) {
  float share = soil * uSeasonCover.w * smoothstep(0.005, 0.025, waterDepth);
  if (share <= 0.0) return;
  albedo = mix(albedo, vec3(dot(albedo, vec3(0.3, 0.59, 0.11))) * vec3(0.68, 0.75, 0.81), share);
}
`;

/**
 * Share of the snow keep redistribution: 1 on worlds with snow areas, the season ramp where only the season snows.
 * The moved snow returns to grass and soil, and while the season can snow (SEASON_SNOW) also to the bare stone it
 * covered, by their weights (grass, soil, stone); without any it becomes soil, as before.
 */
export const SNOW_DISTRIBUTION_SHARE_GLSL = `
float getSnowDistributionShare() {
#ifdef SNOW_DISTRIBUTION_SEASONAL
  return uSeasonCover.w;
#else
  return 1.0;
#endif
}

vec3 getSnowReturnShares(float grass, float soil, float stone) {
#ifndef SEASON_SNOW
  stone = 0.0;
#endif
  float total = grass + soil + stone;
  if (total <= 1e-4) return vec3(0.0, 1.0, 0.0);
  return vec3(grass, soil, stone) / total;
}
`;

/**
 * Snow load of props and far sprites (inside their WINTER block, after WINTER_TREE_GLSL): the theme snow, plus the
 * global season's GPU snow where SEASON_SNOW is compiled. The leaf drop and dry leaves stay with the theme snow (the
 * season's bare crowns are the dormant tint, season-glsl.ts), so the winter -> spring blend never drops twice.
 */
export const PROP_SNOW_GLSL = `
#ifdef SEASON_SNOW
${SEASON_SNOW_GLSL}
#endif
float getPropSnow(vec3 world, float winter) {
#ifdef SEASON_SNOW
  return getSeasonPropSnow(world, winter);
#else
  return winter;
#endif
}
`;

/**
 * Field-cover tufts under the global snow (vertex stage of GRASS_COVER with SEASON_SNOW): about a third stays
 * (like the old winter keep table: the stiff stems poke through), greyed towards the snow. Shared with the TSL twin.
 */
export const SEASON_TUFT_SNOW = { cool: [1.02, 1.05, 1.1], grey: 0.8, thinning: 0.67 } as const;

const tuftCoolGlsl = `vec3(${SEASON_TUFT_SNOW.cool.map(value => glslLiteral(value)).join(", ")})`;

export const SEASON_SNOW_TUFT_GLSL = `
${SNOW_MAP_GLSL}
${SEASON_SNOW_GLSL}
float getSeasonTuftSnow(vec2 root) {
  if (uSeasonCover.w <= 0.0) return 0.0;
  return getSeasonSnowCover(root) * getSnowKeep(root);
}

float getSeasonTuftKeep(float snow, float phase) {
  return step(snow * ${glslLiteral(SEASON_TUFT_SNOW.thinning)}, fract(phase * 0.618034 + 0.29));
}

vec3 coverTuftWithSnow(vec3 color, float snow) {
  vec3 snowy = vec3(dot(color, vec3(0.3, 0.59, 0.11))) * ${tuftCoolGlsl};
  return mix(color, snowy, snow * ${glslLiteral(SEASON_TUFT_SNOW.grey)});
}
`;
