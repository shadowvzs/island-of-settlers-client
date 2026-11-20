import { PREVAILING_WIND_DIRECTION } from "../../shared/world/prevailing-wind";
import { glslLiteral } from "./glsl-literal";

/**
 * Rock walls of the terrain surface (MC-08, needs NOISE_GLSL; full and lite ground). The island
 * draws its mountains with the ground mesh: gentle mountain rock reads as the pale apron gravel
 * (owner, 2026-10-11), but steep and upright faces (rocks/face-upright.ts) are bare rock. Loose
 * cover and snow slide off walls (snow holds up to about 40 degrees). Wall rock is the pebbly apron
 * gravel seen from the side (two wall projections, no top-down stretching), greyed to read as
 * stone, with a little of the rock tile and a slow regional tone; no procedural bands, seams or
 * blotches (owner review 2026-11-07). Noise fetches only where a pixel is wall rock.
 */
/** Shared cliff/summit constants: the TSL twin imports these instead of copying literals. */
export const CLIFF_NORMAL = [0.42, 0.74] as const;
export const SNOW_HOLD_NORMAL = [0.57, 0.77] as const;
export const CLIFF_TINT = [1.0, 0.99, 0.97] as const;
export const CLIFF_OCHRE_TINT = [1.04, 0.94, 0.8] as const;
export const CLIFF_SATURATION = 0.65;
/**
 * Brightness of the wall stone against the pale gravel it is made from: mid-grey rock below the iso noon
 * tonemap shoulder (GROUND-PALETTE bug fix 2026-11-17: at 1.0 the walls clipped to the same cream as the
 * mine gravel and the snow; slightly cool, so the warm sun lights it grey). The TSL twin used 0.8 before;
 * both read this constant now.
 */
export const CLIFF_STONE_TONE = [0.6, 0.64, 0.7] as const;
export const CLIFF_ROCK_SHARE = 0.15;
export const CLIFF_GRAIN_SCALE = 0.65;
export const SUMMIT_SNOW_LINE = 13.55;
export const SUMMIT_SNOW_WANDER = 0.65;
export const SUMMIT_SNOW_FLOOR = 4.2;
export const SUMMIT_SNOW_FADE = 0.65;
export const SUMMIT_SNOW_HOLLOW_RUN = 0.15;
export const SUMMIT_SNOW_LEE = 0.15;
export const SUMMIT_SNOW_HOLD = [0.3, 0.6] as const;
export const SUMMIT_SNOW_WIND = [PREVAILING_WIND_DIRECTION.x, PREVAILING_WIND_DIRECTION.z] as const;
export const SUMMIT_SNOW_NEUTRAL = [0.9, 0.93, 0.98] as const;
export const SUMMIT_SNOW_CLEAN_TONE = [0.93, 0.945, 0.965] as const;
export const SUMMIT_SNOW_CLEAN = 1;

const vec3Glsl = (values: readonly number[]) =>
  `vec3(${values.map(value => glslLiteral(value)).join(", ")})`;
const vec2Glsl = (values: readonly number[]) =>
  `vec2(${values.map(value => glslLiteral(value)).join(", ")})`;

export const GROUND_CLIFF_GLSL = `
/** Ground normal y below which the ground is a rock wall, and above which it is open ground. */
const vec2 CLIFF_NORMAL = ${vec2Glsl(CLIFF_NORMAL)};
/** Snow lies on faces flatter than about 40 degrees and slides off past about 55 degrees. */
const vec2 SNOW_HOLD_NORMAL = ${vec2Glsl(SNOW_HOLD_NORMAL)};

/** Noise with an explicit level: the beds are only evaluated where a pixel is wall rock (a branch). */
float cliffNoise(vec2 p) {
  return textureLod(uNoiseTexture, p / NOISE_LATTICE, 0.0).r;
}

/** 0 open ground .. 1 rock wall. */
float getCliffShare(vec3 normal) {
  return 1.0 - smoothstep(CLIFF_NORMAL.x, CLIFF_NORMAL.y, normal.y);
}

/** Share of the snow that stays on a face of this normal. */
float getSnowHold(vec3 normal) {
  return smoothstep(SNOW_HOLD_NORMAL.x, SNOW_HOLD_NORMAL.y, normal.y);
}

/**
 * Render splat of a mountain surface: gentle rock as the apron gravel (splatC.x), steep rock
 * bare, and loose cover (grass, soil, sand, gravel) and snow sliding off walls onto the rock.
 * Returns the share of the mine layer that is shed rock: the apron reads as grey stone (APRON_TINT),
 * real mine ground keeps its pale quarry gravel.
 */
float shedOntoCliffs(inout vec4 splatA, inout vec4 splatB, inout vec4 splatC, vec3 normal) {
  float cliff = getCliffShare(normal);
  float keepSnow = getSnowHold(normal) * (1.0 - cliff);
  float rock = splatB.y;
  float moved = dot(splatA, vec4(cliff)) + (splatB.x + splatB.w) * cliff + splatB.z * (1.0 - keepSnow);
  splatA *= 1.0 - cliff;
  splatB = vec4(splatB.x * (1.0 - cliff), rock * cliff + moved, splatB.z * keepSnow, splatB.w * (1.0 - cliff));
  float apron = rock * (1.0 - cliff);
  splatC.x += apron;
  return clamp(apron / max(splatC.x, 1e-4), 0.0, 1.0);
}

/**
 * Broad tone of wall rock (owner review 2026-11-07: no bands, ledges, cracks or blotches that read
 * as artefacts): a slow regional variation between grey and a warm, faintly oxidised stone, a
 * function of the world position only (never of the facet normal), so it runs on across facets.
 */
struct CliffBeds {
  /** 0 .. 1 regional tone of the stone. */
  float tone;
  /** 0 .. 1 warm, oxidised share. */
  float ochre;
};

/** Regional tone of the wall rock at a point (two noise fetches). */
CliffBeds getCliffBeds(vec3 world) {
  float tone = cliffNoise(world.xz * 0.045 + world.y * 0.03 + 5.3);
  float ochre = smoothstep(0.55, 0.85, cliffNoise(world.xz * 0.03 - world.y * 0.02 + 8.8));
  return CliffBeds(tone, ochre);
}

/** Cool grey the pale apron gravel takes on a wall (unbleached stone), and its warm variant. */
const vec3 CLIFF_TINT = ${vec3Glsl(CLIFF_TINT)};
const vec3 CLIFF_OCHRE_TINT = ${vec3Glsl(CLIFF_OCHRE_TINT)};
/** Colour kept of the gravel's own tint (the rest greys out). */
const float CLIFF_SATURATION = ${glslLiteral(CLIFF_SATURATION)};
const vec3 CLIFF_STONE_TONE = ${vec3Glsl(CLIFF_STONE_TONE)};
/** Share of the rock tile in the wall grain (the rest is the side-projected gravel). */
const float CLIFF_ROCK_SHARE = ${glslLiteral(CLIFF_ROCK_SHARE)};
/** Scale of the side-projected gravel against its ground tile: coarser stones on a wall. */
const float CLIFF_GRAIN_SCALE = ${glslLiteral(CLIFF_GRAIN_SCALE)};

/**
 * Wall rock albedo by share (0..1): the mountains' own pebbly gravel seen from the side, greyed
 * and darkened to read as stone, with a slow regional tone; no procedural bands or cracks.
 */
vec3 applyCliffBeds(vec3 albedo, vec3 gravel, CliffBeds beds, float share) {
  vec3 grain = mix(gravel, albedo, CLIFF_ROCK_SHARE);
  vec3 stone = mix(vec3(dot(grain, vec3(0.333))), grain, CLIFF_SATURATION);
  vec3 tint = mix(CLIFF_TINT, CLIFF_OCHRE_TINT, beds.ochre * 0.5) * mix(0.94, 1.1, beds.tone);
  return mix(albedo, stone * tint * CLIFF_STONE_TONE, share);
}

/** Summit snow line (world height, the ground splat's band starts at 7) and its broad wander. */
const float SUMMIT_SNOW_LINE = ${glslLiteral(SUMMIT_SNOW_LINE)};
const float SUMMIT_SNOW_WANDER = ${glslLiteral(SUMMIT_SNOW_WANDER)};
/** Below this height the existing ground snow is left alone. */
const float SUMMIT_SNOW_FLOOR = ${glslLiteral(SUMMIT_SNOW_FLOOR)};
/** Height of the soft transition at the edge of the cap. */
const float SUMMIT_SNOW_FADE = ${glslLiteral(SUMMIT_SNOW_FADE)};
/** Small height offsets for hollows and lee faces; neither makes deep runs. */
const float SUMMIT_SNOW_HOLLOW_RUN = ${glslLiteral(SUMMIT_SNOW_HOLLOW_RUN)};
const float SUMMIT_SNOW_LEE = ${glslLiteral(SUMMIT_SNOW_LEE)};
/**
 * Steep faces raise the snow line, while hollows lower it even on steep ground. Neither can remove
 * snow from the cap above the line.
 */
const vec2 SUMMIT_SNOW_HOLD = ${vec2Glsl(SUMMIT_SNOW_HOLD)};
const vec2 SUMMIT_SNOW_WIND =
  vec2(${SUMMIT_SNOW_WIND[0].toFixed(4)}, ${SUMMIT_SNOW_WIND[1].toFixed(4)});

/**
 * Summit snow 0..1 at a point (WALL-PATCHES, owner 2026-11-10): an altitude line that wanders with a
 * broad noise, with small offsets for hollows, wind and slope. The offsets move the edge rather
 * than thinning the snow above it, leaving an opaque cap confined to the upper massif.
 */
float getSummitSnow(vec3 world, vec3 normal, float occlusion) {
  float broad = cliffNoise(world.xz * 0.07 + 2.3);
  float hollow = clamp((0.92 - occlusion) * 2.5, 0.0, 1.0);
  float lee = dot(normalize(normal.xz + vec2(1e-4)), SUMMIT_SNOW_WIND) * (1.0 - normal.y);
  float hold = smoothstep(SUMMIT_SNOW_HOLD.x, SUMMIT_SNOW_HOLD.y, normal.y + hollow * 0.45);
  // Two isotropic octaves give the edge a small, irregular wander.
  float breakup = cliffNoise(world.xz * 0.16 + world.y * 0.05 + 9.1) * 0.55
    + cliffNoise(world.xz * 0.45 + 4.7) * 0.45;
  float line = SUMMIT_SNOW_LINE + (broad - 0.5) * SUMMIT_SNOW_WANDER - hollow * SUMMIT_SNOW_HOLLOW_RUN
    - lee * SUMMIT_SNOW_LEE + (1.0 - hold) * 0.25 + (breakup - 0.5) * 0.3;
  return smoothstep(line, line + SUMMIT_SNOW_FADE, world.y);
}

/**
 * Replaces the vertex splat's height band of snow on the upper massif by getSummitSnow: snow given
 * up becomes bare rock, snow gained takes its share evenly from every other layer (splatC.x is the
 * last layer; its other channels carry mine data). Lower ground and the winter theme's own snow
 * keep the splat.
 */
void shapeSummitSnow(inout vec4 splatA, inout vec4 splatB, inout vec4 splatC, vec3 world, vec3 normal,
  float occlusion) {
  if (world.y < SUMMIT_SNOW_FLOOR) return;
  float band = smoothstep(SUMMIT_SNOW_FLOOR, SUMMIT_SNOW_FLOOR + 1.0, world.y);
  float splatSnow = splatB.z;
  float summit = max(getSummitSnow(world, normal, occlusion), splatSnow * (1.0 - band));
  float snow = mix(splatSnow, summit, band);
  if (snow < splatSnow) {
    splatB.y += splatSnow - snow;
    splatB.z = snow;
    return;
  }
  float keep = (1.0 - snow) / max(1.0 - splatSnow, 1e-4);
  splatA *= keep;
  splatC.x *= keep;
  splatB = vec4(splatB.x * keep, splatB.y * keep, snow, splatB.w * keep);
}

/** 0 lowland .. 1 upper massif: where the summit snow shape and look apply. */
float getSummitSnowShare(float height) {
  return smoothstep(SUMMIT_SNOW_FLOOR, SUMMIT_SNOW_FLOOR + 1.5, height);
}

/**
 * Summit snow tone over the clean tile tone: a faint cool cast a little below white, so the warm day sun
 * lights it white-blue without a bloom halo (GROUND-PALETTE bug fix 2026-11-17: the warm 1.05/1.0/0.92
 * read the same cream as the pale mountain gravel); shade stays cool.
 */
const vec3 SUMMIT_SNOW_NEUTRAL = ${vec3Glsl(SUMMIT_SNOW_NEUTRAL)};

/**
 * Summit snow tint (SNOW-SOFTEN, owner 2026-11-10): natural white instead of the tile's blue, with
 * soft drift undulation and faint wind ridges across the prevailing wind, so wide snowfields are
 * not flat. Shared by the full and the lite ground; the lowland and winter snow keep their tint.
 */
vec3 tintSummitSnow(vec3 tint, vec3 world) {
  float share = getSummitSnowShare(world.y);
  if (share <= 0.0) return tint;
  float drift = cliffNoise(world.xz * 0.42 + 21.7);
  float ridges = sin(dot(world.xz, SUMMIT_SNOW_WIND) * 3.4 + drift * 7.0) * 0.5 + 0.5;
  float tone = 1.02 + (drift - 0.5) * 0.06 - ridges * 0.02;
  return mix(tint, tint * SUMMIT_SNOW_NEUTRAL * tone, share);
}

/**
 * Summit snow replaces the snow tile's texel by its clean mean tone (share SUMMIT_SNOW_CLEAN): the
 * tile's painted stones would read as dark or beige spots in a summit snowfield.
 */
const vec3 SUMMIT_SNOW_CLEAN_TONE = ${vec3Glsl(SUMMIT_SNOW_CLEAN_TONE)};
const float SUMMIT_SNOW_CLEAN = ${glslLiteral(SUMMIT_SNOW_CLEAN)};

/**
 * SNOW-LAYER (owner 2026-11-10): summit snow reads as a layer on the rock, not a colouring. Inside
 * the field the snow fills the pits (flat normal, no rock occlusion, no painted stones); a brighter
 * rounded lip runs along its edge and the rock just outside it takes a thin contact shade.
 * layer is the summit snow share of the pixel (0..1); albedo and surface are the blended ground;
 * edgeCue 0 drops the lip and the contact shade (the lite ground's softer blend would widen them
 * into a dark frame).
 */
void applySummitSnowLayer(inout vec3 albedo, inout vec4 surface, float layer, float edgeCue) {
  if (layer <= 0.0) return;
  // Snow reflects more sky light than rock; keep shaded faces legible without changing other ground.
  albedo *= mix(1.0, 1.65, layer);
  surface.xy *= 1.0 - layer * 0.9;
  surface.z = mix(surface.z, 1.0, layer * 0.9);
  float lip = smoothstep(0.4, 0.75, layer) * (1.0 - smoothstep(0.9, 1.0, layer));
  float contact = smoothstep(0.02, 0.15, layer) * (1.0 - smoothstep(0.2, 0.4, layer));
  albedo *= 1.0 + (lip * 0.1 - contact * 0.18) * edgeCue;
}

/** Baked occlusion of a wall: the heightfield horizon over-darkens a face that now stands upright. */
float getCliffOcclusion(float occlusion, vec3 normal) {
  return mix(occlusion, 1.0, getCliffShare(normal) * 0.6);
}
`;
