import { glslLiteral } from "./glsl-literal";

/**
 * Ground context tuning shared by the GLSL grounds (full, lite) and the TSL twin (GROUND-PALETTE,
 * owner 2026-11-17). Uniform/ALU only: no texture fetch.
 */
export const GROUND_CONTEXT_TUNING = {
  /**
   * Gentle mountain rock drawn with the apron gravel tile reads as mid-grey stone (mine mean 174/168/156 →
   * about 104/106/109), and real mine ground as a light warm quarry gravel: both below the iso noon
   * tonemap shoulder, where the pale tile, the snow and the gravel all clipped to one cream (bug fix
   * 2026-11-17).
   */
  apronTint: [0.58, 0.62, 0.7],
  /**
   * Real mine ground (the mountains' mine zones: most of a massif's gentle body) as a mid warm-grey quarry
   * gravel (about 108/104/100 and half desaturated), not pale cream: at 0.88/0.85/0.8 the whole massif still
   * read cream-beige at iso under the warm sun (review 2026-11-17). Warmer than the apron's cool grey, so mine
   * ground stays recognisable.
   */
  mineTint: [0.62, 0.62, 0.64],
  mineGrey: 0.45,
  /** Clover meadow (the lush grass layer): cooler, deeper green than the lawn. */
  cloverTint: [0.94, 1.0, 0.9],
  /** Dryness response per theme (ISLAND_THEMES order: meadow, desert, dirt, snowy). */
  dryThemeStrength: [1, 1.6, 1.4, 0.5],
  /** Exposure dryness (surface.w × theme strength) where the sunny patches start and are full. */
  dryRange: [0.1, 0.28],
  /** Noise breakup of the sunny patches (macro patches, fine breakup): soft, natural borders. */
  dryBreakup: [0.16, 0.05],
  /** Olive first, straw on the driest ground, and how much of each. */
  dryOlive: [1.02, 1.03, 0.7],
  dryOliveShare: 0.45,
  dryStrawShare: 0.7,
  /**
   * Under water the sand palette fades toward the painted tile (the seabed takes silt and algae; a red or
   * golden bed would dye the shallows): water depth where the fade starts and is full, and its share.
   */
  seabedFade: [0.05, 0.8, 0.7],
  /** Albedo factor of saturated porous ground other than sand (the sand takes its palette's). */
  wetDarken: 0.68
} as const;

const vec3Literal = (values: readonly number[]) => `vec3(${values.map(value => glslLiteral(value)).join(", ")})`;
const vec4Literal = (values: readonly number[]) => `vec4(${values.map(value => glslLiteral(value)).join(", ")})`;

/**
 * Per pixel ground context of the full and the lite ground: the island palette of the sand and the
 * soil (uSandPalette / uSoilPalette, one column per theme, mixed by the vertex theme weights), the
 * sunny-slope dryness and the share of the mine layer that is shed mountain rock (grey apron).
 */
export const GROUND_PALETTE_GLSL = `
uniform mat4 uSandPalette;
uniform mat4 uSoilPalette;
uniform mat4 uRockPalette;
uniform mat4 uClimatePalette;

const float GROUND_WET_DARKEN = ${glslLiteral(GROUND_CONTEXT_TUNING.wetDarken)};
const vec3 APRON_TINT = ${vec3Literal(GROUND_CONTEXT_TUNING.apronTint)};
const vec3 MINE_TINT = ${vec3Literal(GROUND_CONTEXT_TUNING.mineTint)};
const float MINE_GREY = ${glslLiteral(GROUND_CONTEXT_TUNING.mineGrey)};
const vec3 CLOVER_TINT = ${vec3Literal(GROUND_CONTEXT_TUNING.cloverTint)};
const vec4 DRY_THEME_STRENGTH = ${vec4Literal(GROUND_CONTEXT_TUNING.dryThemeStrength)};
const vec3 SEABED_FADE = ${vec3Literal(GROUND_CONTEXT_TUNING.seabedFade)};

struct GroundContext {
  /** Sand tint and its wet albedo factor. */
  vec3 sand;
  float sandWet;
  vec3 soil;
  /** Swamp climate share (soil palette column w): swamp mud on bare soil (ground-variant-layers-glsl.ts). */
  float swamp;
  /** Share of the mine layer that is shed mountain rock (0 real mine ground .. 1 apron). */
  float apron;
  /** Rock tint and the basalt tile share (rock palette column w; step 5). */
  vec3 rock;
  float lava;
  /** Climate shares (step 5, 7): heather moorland on exposed grass, the jungle forest floor. */
  float heather;
  float jungle;
};

/** The four theme weights: xyz from the attribute, the snowy weight the rest (theme.w carries the tilled paint). */
vec4 getThemeWeights(vec4 theme) {
  vec4 weights = vec4(theme.xyz, max(1.0 - dot(theme.xyz, vec3(1.0)), 0.0));
  return weights / max(dot(weights, vec4(1.0)), 1e-3);
}

/** Exposure dryness of the sunny-slope meadow tint, scaled by the theme. */
float getGroundDryness(vec4 theme, vec4 surface) {
  return surface.w * dot(getThemeWeights(theme), DRY_THEME_STRENGTH);
}

GroundContext getGroundContext(vec4 theme, float apron, float waterDepth) {
  vec4 weights = getThemeWeights(theme);
  vec4 sand = uSandPalette * weights;
  sand.rgb = mix(sand.rgb, vec3(1.0), smoothstep(SEABED_FADE.x, SEABED_FADE.y, waterDepth) * SEABED_FADE.z);
  vec4 soil = uSoilPalette * weights;
  vec4 rock = uRockPalette * weights;
  vec2 climate = (uClimatePalette * weights).xy;
  return GroundContext(sand.rgb, sand.w, soil.rgb, soil.w, apron, rock.rgb, rock.w, climate.x, climate.y);
}

/** Wet albedo factor of a pixel by its sand share. */
float getWetDarken(GroundContext context, float sandShare) {
  return mix(GROUND_WET_DARKEN, context.sandWet, clamp(sandShare, 0.0, 1.0));
}
`;

/**
 * The island palette on a blended ground sample (needs the variant's GroundSample with mine, paletteShares
 * and wetDarken): each tint scales the pixel by its layer's share (sand, soil, clover, the mine layer's
 * quarry or grey apron tint, and the rock palette on the rock and the apron), clamped to white, and the sand's
 * wet factor. Applied after sampleGround, so the
 * layer loops carry no context (register pressure).
 */
export const GROUND_PALETTE_APPLY_GLSL = `
void applyGroundPalette(inout GroundSample ground, GroundContext context) {
  vec4 shares = ground.paletteShares;
  float quarry = ground.mine * (1.0 - context.apron);
  // The whole massif: bare rock and the mine layer (shed apron rock and quarry gravel alike).
  float rock = clamp(shares.w + ground.mine, 0.0, 1.0);
  ground.albedo = mix(ground.albedo, vec3(dot(ground.albedo, vec3(0.333))), quarry * MINE_GREY);
  vec3 tint = mix(vec3(1.0), context.sand, shares.x) * mix(vec3(1.0), context.soil, shares.y)
    * mix(vec3(1.0), CLOVER_TINT, shares.z)
    * mix(vec3(1.0), mix(MINE_TINT, APRON_TINT, context.apron), ground.mine)
    * mix(vec3(1.0), context.rock, rock);
  ground.albedo = min(ground.albedo * tint, vec3(1.0));
  ground.wetDarken = getWetDarken(context, shares.x);
}
`;

/** The sunny-slope term of meadowTint (GROUND_MACRO_GLSL): dryness → olive, then straw. */
export const MEADOW_DRY_GLSL = `
const vec2 MEADOW_DRY_RANGE = vec2(${GROUND_CONTEXT_TUNING.dryRange.map(value => glslLiteral(value)).join(", ")});
const vec3 MEADOW_DRY_OLIVE = ${vec3Literal(GROUND_CONTEXT_TUNING.dryOlive)};

/** 0..1 sunny-slope dryness with noise-broken borders (no hard edges). */
float getSunnyDryness(GroundMacro macro, float dry) {
  float broken = dry + (macro.patches.z - 0.5) * ${glslLiteral(GROUND_CONTEXT_TUNING.dryBreakup[0])}
    + (macro.breakup.y - 0.5) * ${glslLiteral(GROUND_CONTEXT_TUNING.dryBreakup[1])};
  return smoothstep(MEADOW_DRY_RANGE.x, MEADOW_DRY_RANGE.y, broken);
}
`;
