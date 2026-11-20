import {
  GROUND_DETAIL_IDS, GROUND_LITTER_IDS, GROUND_VARIANT_TILE_IDS
} from "../../shared/world/ground-variants";
import { MATERIAL, MATERIAL_COUNT } from "../../shared/world/world-data";
import { glslLiteral } from "./glsl-literal";
import { SEASON_GROUND_UNIFORMS_GLSL, SEASON_WETNESS_GLSL } from "./season-ground-glsl";

/**
 * Render-only ground variant layers (GROUND-PALETTE step 2, owner 2026-11-17): CC0 photo tiles appended to the
 * ground texture arrays after the nine splat materials (assets/ground-variants, tools/assets/ground-variant-tiles.ts).
 * They own no splat channel and change no gameplay: a per-pixel mask from the surface mask, the splat, the canopy,
 * the theme and the editor's variant paint lays them over the blended ground sample (after sampleGround, like the
 * palette, so the layer loops carry no extra registers). High: albedo + normal (2 fetches) only where a mask is
 * set; Minimal: the albedo only (1 fetch). Shared with the TSL twin through these constants.
 */
export {
  GROUND_DETAIL_COUNT, GROUND_DETAIL_IDS, GROUND_LITTER_COUNT, GROUND_LITTER_IDS, GROUND_VARIANT_COUNT,
  GROUND_VARIANT_IDS, GROUND_VARIANT_TILE_COUNT, GROUND_VARIANT_TILE_IDS
} from "../../shared/world/ground-variants";
/** Texture array layer of each variant (after the base materials). */
export const GROUND_VARIANT_LAYERS = GROUND_VARIANT_TILE_IDS.map((_, index) => MATERIAL_COUNT + index);
/** Texture array layer of each litter tile (after the variants). */
export const GROUND_LITTER_LAYERS = GROUND_LITTER_IDS.map((_, index) =>
  MATERIAL_COUNT + GROUND_VARIANT_TILE_IDS.length + index);
/** Texture array layer of each climate detail tile (after the litter). */
export const GROUND_DETAIL_LAYERS = GROUND_DETAIL_IDS.map((_, index) =>
  MATERIAL_COUNT + GROUND_VARIANT_TILE_IDS.length + GROUND_LITTER_IDS.length + index);

export const GROUND_VARIANT_TUNING = {
  /** World units per tile repeat (stones coarser than the gravel tile, the moss finer). */
  tileUnits: [5, 5, 7, 8],
  /** Height blend: the mask's edge width and how much the tile's height and the noise move it. */
  edge: [0.32, 0.68],
  heightShare: 0.7,
  noiseShare: 0.45,
  /** Stony shore: coast type (surface.y) × height above the water band × the sand/gravel share. */
  shoreHeight: [0.25, 0.9],
  shoreGain: 1.6,
  /** Scree: talus (surface.z) × the mountain grounds' share. */
  screeGain: 1.4,
  /**
   * Scree breakup (review 2026-11-17: the talus band read as concentric rings around the massif): a mid-scale
   * lobe noise, smeared downslope by the talus itself, decides the outer band, so the stones run out in fans and
   * tongues and only the cliff foot is continuous. Lobe scale (per world unit), downslope smear (world units at
   * full talus), lobe share, and the mask's start/full.
   */
  screeLobes: [0.55, 3.0, 0.9],
  screeRange: [0.08, 0.85],
  /** Rock grey of the scree stones (the beach stones take the sand palette). */
  screeTint: [0.82, 0.85, 0.92],
  /** Moss: forest floor under dense canopy away from sunny, dry ground. */
  mossCanopy: [0.2, 0.6],
  mossDry: [0.04, 0.16],
  /** Slightly richer green than the photo, so the moss reads at iso distance. */
  mossTint: [0.82, 0.97, 0.7],
  /**
   * Moss on wet, upward-facing rock (flat rock tops away from dry and desert ground): terrain normal y band,
   * the patch noise threshold (scattered cushions, never a carpet) and its share.
   */
  rockMossNormal: [0.72, 0.9],
  rockMossPatch: [0.52, 0.74],
  rockMossShare: 0.85,
  /** World height band where the rock moss thins out (below the summit snow and the bare upper massif). */
  rockMossHeight: [3.0, 5.5],
  /** Swamp mud: wet banks (surface.x) and the swamp climate on bare soil. */
  mudWetGain: 2.2,
  /** Cracked earth: dry desert soil; low flats near the sea turn white (salt flat). */
  crackedDry: [0.0, 0.08],
  saltHeight: [1.6, 0.5],
  saltTint: [1.32, 1.36, 1.4],
  /**
   * Share of the island soil tint in the cracked earth (dry, bleached: mostly its own neutral ochre; the half
   * share read pink on terra rossa, review 2026-11-17) and the ochre tint.
   */
  crackedSoilShare: 0.12,
  crackedTint: [1.0, 0.97, 0.72],
  /**
   * Crown litter (steps 3–4): world units per tile repeat (pine needles, leaf litter) and the litter field range
   * where it starts and is full; it lies on the loose ground (grass, forest floor, soil), never on sand, rock or
   * snow, and no leaf litter in the desert.
   */
  litterTileUnits: [4, 5],
  /** Leaf litter a little less orange (the in-game check read it autumnal on Minimal; ground-palette-3). */
  leafLitterTint: [0.9, 0.95, 1.04],
  litterRange: [0.12, 0.8],
  /** Mask share kept where the patch noise thins the litter out. */
  litterThin: 0.45,
  /**
   * Altitude zonation of the grass (step 4: meadow → alpine meadow with stones → lichen grass → scree → rock →
   * snow): world height bands of the alpine meadow and the lichen grass (a broad noise wobbles both), their tints
   * (short, cooler-yellow alpine grass; grey-olive lichen grass, partly desaturated), and the scattered stones:
   * patch noise start/full in the alpine and in the lichen band, and their share.
   */
  alpineHeight: [1.7, 2.5],
  /**
   * Lichen grass from 2.4, full by 3.2: a broad grey-olive band up to where the grass stops (about height 4 on the
   * generated islands), so meadow → alpine → lichen → scree → rock reads at iso distance (ground-palette-3; the
   * 2.9–3.8 band read as a thin rim).
   */
  lichenHeight: [2.4, 3.2],
  /**
   * The same zones by the mountain foot (ground-zone-field.ts: closeness to rock and mine land), so the sequence
   * also reads on low massifs: alpine and lichen ranges of the foot value, and the height above which it applies
   * (no lichen on a cliff coast at sea level).
   */
  alpineFoot: [0.03, 0.25],
  lichenFoot: [0.3, 0.6],
  footHeight: [0.5, 1.2],
  alpineTint: [1.0, 0.97, 0.84],
  lichenTint: [1.0, 0.92, 0.7],
  lichenGrey: 0.6,
  alpineStonePatch: [0.66, 0.84],
  lichenStonePatch: [0.5, 0.72],
  alpineStoneShare: 0.85,
  /**
   * Basalt (step 5): world units per tile repeat, and the gentler rock (terrain normal y start/full) the top-down
   * tile lies on; the walls keep the dark basalt palette tint of the rock.
   */
  basaltTileUnits: 7,
  basaltNormal: [0.45, 0.75],
  /**
   * Rounded pebbles (step 6): world units per repeat (rounded stones a little larger than the photo's), the river
   * bank wetness (surface.x) where they start and are full, the patch noise that thins them on the exposed bank,
   * and the wet tint of the exposed bank pebbles (the bed under water gets the water's own colour).
   */
  pebbleTileUnits: 6.5,
  pebbleBank: [0.24, 0.38],
  pebblePatch: [0.3, 0.62],
  pebbleWet: [0.78, 0.79, 0.82],
  /**
   * Tilled garden soil (editor paint, step 6): the dirt tile in soft furrows. Furrow spacing (world units), trough
   * and ridge shading, the moist soil tint on the island soil, how far the furrow normal tilts (High), and the
   * screen footprint (world units per pixel) over which the furrows fade (no aliasing far away).
   */
  tilledSpacing: 0.42,
  tilledShade: [0.7, 1.08],
  tilledSoil: [0.84, 0.82, 0.8],
  tilledTilt: 0.5,
  tilledFade: [0.06, 0.16]
} as const;

const vec2Literal = (values: readonly number[]) => `vec2(${values.map(value => glslLiteral(value)).join(", ")})`;
const vec3Literal = (values: readonly number[]) => `vec3(${values.map(value => glslLiteral(value)).join(", ")})`;
const vec4Literal = (values: readonly number[]) => `vec4(${values.map(value => glslLiteral(value)).join(", ")})`;
const tuning = GROUND_VARIANT_TUNING;

/**
 * Variant masks and their overlay (needs GROUND_LAYERS_GLSL, GROUND_TANGENT_GLSL, GROUND_PALETTE_GLSL and the
 * variant's GroundSample). GROUND_VARIANT_NORMALS (full ground) adds the normal/AO/roughness fetch.
 */
export const GROUND_VARIANT_LAYERS_GLSL = `
const vec4 VARIANT_LAYERS = ${vec4Literal(GROUND_VARIANT_LAYERS)};
const vec4 VARIANT_SCALES = ${vec4Literal(tuning.tileUnits.map(units => 1 / units))};
const vec2 VARIANT_EDGE = ${vec2Literal(tuning.edge)};
const vec2 VARIANT_SHORE_HEIGHT = ${vec2Literal(tuning.shoreHeight)};
const vec3 VARIANT_SCREE_TINT = ${vec3Literal(tuning.screeTint)};
const vec2 VARIANT_MOSS_CANOPY = ${vec2Literal(tuning.mossCanopy)};
const vec2 VARIANT_MOSS_DRY = ${vec2Literal(tuning.mossDry)};
const vec2 VARIANT_CRACKED_DRY = ${vec2Literal(tuning.crackedDry)};
const vec2 VARIANT_SALT_HEIGHT = ${vec2Literal(tuning.saltHeight)};
const vec3 VARIANT_SALT_TINT = ${vec3Literal(tuning.saltTint)};
const vec3 VARIANT_SCREE_LOBES = ${vec3Literal(tuning.screeLobes)};
const vec2 VARIANT_SCREE_RANGE = ${vec2Literal(tuning.screeRange)};
const vec3 VARIANT_MOSS_TINT = ${vec3Literal(tuning.mossTint)};
const vec2 VARIANT_ROCK_MOSS_NORMAL = ${vec2Literal(tuning.rockMossNormal)};
const vec2 VARIANT_ROCK_MOSS_PATCH = ${vec2Literal(tuning.rockMossPatch)};
const vec2 VARIANT_ROCK_MOSS_HEIGHT = ${vec2Literal(tuning.rockMossHeight)};
const vec3 VARIANT_CRACKED_TINT = ${vec3Literal(tuning.crackedTint)};
const mat2 VARIANT_TURN = mat2(0.8, 0.6, -0.6, 0.8);
const vec2 LITTER_LAYERS = ${vec2Literal(GROUND_LITTER_LAYERS)};
const vec2 LITTER_SCALES = ${vec2Literal(tuning.litterTileUnits.map(units => 1 / units))};
const vec2 LITTER_RANGE = ${vec2Literal(tuning.litterRange)};
const vec3 LEAF_LITTER_TINT = ${vec3Literal(tuning.leafLitterTint)};
const float LITTER_THIN = ${glslLiteral(tuning.litterThin)};
const vec2 ALPINE_HEIGHT = ${vec2Literal(tuning.alpineHeight)};
const vec2 LICHEN_HEIGHT = ${vec2Literal(tuning.lichenHeight)};
const vec2 ALPINE_FOOT = ${vec2Literal(tuning.alpineFoot)};
const vec2 LICHEN_FOOT = ${vec2Literal(tuning.lichenFoot)};
const vec2 ALPINE_FOOT_HEIGHT = ${vec2Literal(tuning.footHeight)};
const vec3 ALPINE_TINT = ${vec3Literal(tuning.alpineTint)};
const vec3 LICHEN_TINT = ${vec3Literal(tuning.lichenTint)};
const vec2 ALPINE_STONE_PATCH = ${vec2Literal(tuning.alpineStonePatch)};
const vec2 LICHEN_STONE_PATCH = ${vec2Literal(tuning.lichenStonePatch)};
const float BASALT_LAYER = ${glslLiteral(GROUND_DETAIL_LAYERS[0]!)};
const float BASALT_SCALE = ${glslLiteral(1 / tuning.basaltTileUnits)};
const vec2 BASALT_NORMAL = ${vec2Literal(tuning.basaltNormal)};
const float PEBBLE_LAYER = ${glslLiteral(GROUND_DETAIL_LAYERS[1]!)};
const float PEBBLE_SCALE = ${glslLiteral(1 / tuning.pebbleTileUnits)};
const vec2 PEBBLE_BANK = ${vec2Literal(tuning.pebbleBank)};
const vec2 PEBBLE_PATCH = ${vec2Literal(tuning.pebblePatch)};
const vec3 PEBBLE_WET = ${vec3Literal(tuning.pebbleWet)};
const float TILLED_LAYER = ${glslLiteral(MATERIAL.dirt)};
const vec2 TILLED_SHADE = ${vec2Literal(tuning.tilledShade)};
const vec3 TILLED_SOIL = ${vec3Literal(tuning.tilledSoil)};
const vec2 TILLED_FADE = ${vec2Literal(tuning.tilledFade)};

/** Every render-only detail mask of a pixel (variant tiles, litter, climate tiles, editor paint). */
struct GroundDetail {
  /** Variant tiles: x scree stones, y moss, z swamp mud, w cracked earth. */
  vec4 variants;
  /** Crown litter: x pine needles, y leaf litter. */
  vec2 litter;
  /** Share of the stones that is scree (rock grey; the rest takes the sand palette). */
  float screeShare;
  float basalt;
  /** Rounded pebbles (river beds and banks, fall pools, stony shores) and the shore's share of them. */
  float pebbles;
  float pebbleShore;
  /** Tilled garden soil (editor paint or crop plot) and the crop plot share (furrows along the world axes). */
  float tilled;
  float fieldRows;
};

/** Analytic (no fetch) 0..1 patch noise that breaks the variant edges. */
float getVariantNoise(vec2 xz) {
  float a = sin(dot(xz, vec2(0.73, -0.41)) + sin(dot(xz, vec2(-0.29, 0.61)) * 1.7) * 1.3);
  float b = sin(dot(xz, vec2(2.3, 1.7)) + a * 1.9);
  return clamp(0.5 + a * 0.3 + b * 0.2, 0.0, 1.0);
}
${SEASON_GROUND_UNIFORMS_GLSL}
${SEASON_WETNESS_GLSL}

/**
 * Altitude zone 0..1 of the grass: x alpine meadow, y lichen grass, by height and by the mountain foot (foot:
 * ground-zone-field.ts), both wobbled by a broad noise.
 */
vec2 getAlpineZone(vec3 world, float foot) {
  // Lowland away from the mountains (most pixels) skips the noise: the height wobble is at most ±0.7.
  if (world.y < ALPINE_HEIGHT.x - 0.7 && (foot <= 0.0 || world.y < ALPINE_FOOT_HEIGHT.x)) return vec2(0.0);
  float wobble = getVariantNoise(world.xz * 0.21 + 3.0) - 0.5;
  float height = world.y + wobble * 1.4;
  float near = (foot + wobble * 0.3) * smoothstep(ALPINE_FOOT_HEIGHT.x, ALPINE_FOOT_HEIGHT.y, world.y);
  return vec2(
    max(smoothstep(ALPINE_HEIGHT.x, ALPINE_HEIGHT.y, height), smoothstep(ALPINE_FOOT.x, ALPINE_FOOT.y, near)),
    max(smoothstep(LICHEN_HEIGHT.x, LICHEN_HEIGHT.y, height), smoothstep(LICHEN_FOOT.x, LICHEN_FOOT.y, near)));
}

/** Scattered stones in the alpine meadow, denser in the lichen grass. */
float getAlpineStones(float grass, vec2 zone, vec2 xz) {
  if (zone.x <= 0.0 || grass < 0.01) return 0.0;
  vec2 patchRange = mix(ALPINE_STONE_PATCH, LICHEN_STONE_PATCH, zone.y);
  return grass * zone.x * smoothstep(patchRange.x, patchRange.y, getVariantNoise(xz * 0.8 + 9.0))
    * ${glslLiteral(tuning.alpineStoneShare)};
}

/** Alpine grass: shorter, cooler-yellow, then grey-olive lichen grass higher up (grass share of the raw splat). */
void applyAlpineGrass(inout GroundSample ground, float grass, vec2 zone) {
  float share = grass * zone.x;
  if (share <= 0.0) return;
  vec3 lichen = mix(ground.albedo, vec3(dot(ground.albedo, vec3(0.333))), ${glslLiteral(tuning.lichenGrey)})
    * LICHEN_TINT;
  ground.albedo = mix(ground.albedo, mix(ground.albedo * ALPINE_TINT, lichen, zone.y), share);
}

/**
 * Scree at the cliff feet: the talus band × the mountain grounds, its outer part broken into fans and tongues
 * by a lobe noise smeared downslope (no concentric rings).
 */
float getScreeMask(float talus, float mountainGround, vec3 normal, vec2 xz) {
  if (talus < 0.01) return 0.0;
  vec2 down = normalize(normal.xz + vec2(1e-4, 0.0));
  float lobes = getVariantNoise(xz * VARIANT_SCREE_LOBES.x + down * talus * VARIANT_SCREE_LOBES.y + 17.0);
  float scree = talus * mountainGround * ${glslLiteral(tuning.screeGain)};
  return smoothstep(VARIANT_SCREE_RANGE.x, VARIANT_SCREE_RANGE.y, scree + (lobes - 0.5) * VARIANT_SCREE_LOBES.z);
}

/**
 * Moss: the forest floor under canopy away from sunny, dry ground, and scattered cushions on wet, upward-facing
 * rock (not in the desert or the snow).
 */
float getMossMask(float forest, float rock, float canopy, float dry, vec4 themeWeights, vec3 normal, vec3 world) {
  float damp = 1.0 - smoothstep(VARIANT_MOSS_DRY.x, VARIANT_MOSS_DRY.y, dry);
  float forestMoss = forest * smoothstep(VARIANT_MOSS_CANOPY.x, VARIANT_MOSS_CANOPY.y, canopy)
    * (1.0 - themeWeights.w);
  if (rock < 0.01 || world.y > VARIANT_ROCK_MOSS_HEIGHT.y || normal.y < VARIANT_ROCK_MOSS_NORMAL.x) {
    return forestMoss * damp;
  }
  float patches = smoothstep(VARIANT_ROCK_MOSS_PATCH.x, VARIANT_ROCK_MOSS_PATCH.y,
    getVariantNoise(world.xz * 0.9 + 5.0));
  float lowland = 1.0 - smoothstep(VARIANT_ROCK_MOSS_HEIGHT.x, VARIANT_ROCK_MOSS_HEIGHT.y, world.y);
  float onRock = rock * smoothstep(VARIANT_ROCK_MOSS_NORMAL.x, VARIANT_ROCK_MOSS_NORMAL.y, normal.y) * patches
    * lowland * (1.0 - themeWeights.y - themeWeights.w) * ${glslLiteral(tuning.rockMossShare)};
  return max(forestMoss, onRock) * damp;
}

/**
 * Masks 0..1 of the four variants (x stones, y moss, z swamp mud, w cracked earth): the procedural context, raised
 * to the editor's painted variant (paint). swamp is the climate's swamp share (soil palette column w).
 */
/**
 * Rounded pebbles of rivers 0..1 by the bank wetness (surface.x: river beds, banks and fall spray): the whole bed
 * under the water, thinning out in patches on the exposed bank.
 */
float getRiverPebbles(float bank, float height, vec2 xz) {
  if (bank < PEBBLE_BANK.x - 0.08) return 0.0;
  float patches = getVariantNoise(xz * 0.4 + 23.0);
  float band = smoothstep(PEBBLE_BANK.x, PEBBLE_BANK.y, bank + (patches - 0.5) * 0.16);
  float exposed = smoothstep(-0.02, 0.05, height);
  return band * mix(1.0, smoothstep(PEBBLE_PATCH.x, PEBBLE_PATCH.y, patches), exposed);
}

/**
 * The detail masks 0..1 from the procedural context, raised to the editor's painted variants (paint, tilled):
 * stony shores and river beds take the rounded pebbles, cliff feet and alpine grass the angular scree stones. swamp
 * is the climate's swamp share (soil palette column w). Litter and
 * basalt are filled by the caller.
 */
GroundDetail getGroundDetail(vec4 splatA, vec4 splatB, vec4 splatC, vec4 surface, vec4 themeWeights, vec4 paint,
  float tilled, float canopy, float signedDepth, float swamp, vec3 normal, vec3 world, vec2 alpine) {
  float height = -signedDepth;
  float shore = surface.y * (1.0 - smoothstep(VARIANT_SHORE_HEIGHT.x, VARIANT_SHORE_HEIGHT.y, height))
    * smoothstep(-0.3, 0.0, height) * (splatB.x + splatB.w) * ${glslLiteral(tuning.shoreGain)};
  float river = getRiverPebbles(surface.x, height, world.xz);
  float scree = getScreeMask(surface.z, clamp(splatB.w + splatB.y + splatC.x + splatA.w, 0.0, 1.0), normal,
    world.xz);
  scree = max(scree, getAlpineStones(clamp(splatA.x + splatA.y, 0.0, 1.0), alpine, world.xz));
  float moss = getMossMask(splatA.z, splatB.y, canopy, surface.w, themeWeights, normal, world);
  float mud = getSeasonMud(splatA.w * max(surface.x * ${glslLiteral(tuning.mudWetGain)}, swamp), splatA.w,
    themeWeights.y, world.xz);
  float cracked = splatA.w * themeWeights.y * smoothstep(VARIANT_CRACKED_DRY.x, VARIANT_CRACKED_DRY.y, surface.w);
  vec4 variants = max(clamp(vec4(scree, moss, mud, cracked), 0.0, 1.0), paint);
  float pebbles = clamp(max(shore, river), 0.0, 1.0);
  // Painted stones on a beach take the sand palette, like the shore's.
  float screeShare = scree / max(max(scree, paint.x * (splatB.x + splatB.w)), 1e-3);
  return GroundDetail(variants, vec2(0.0), clamp(screeShare, 0.0, 1.0), 0.0, pebbles,
    shore / max(shore + river, 1e-3), tilled, 0.0);
}

/**
 * Crown litter masks 0..1 (x pine needles, y leaf litter) from the trees' litter field on the loose ground of the
 * raw splat (grass, clover, forest floor, soil; minus the snow).
 */
vec2 getGroundLitterMasks(vec4 splatA, vec4 splatB, vec4 litter, vec4 themeWeights, vec3 world) {
  if (max(litter.x, litter.y) <= LITTER_RANGE.x) return vec2(0.0);
  float loose = clamp(dot(splatA, vec4(1.0)), 0.0, 1.0) * (1.0 - splatB.z);
  vec2 masks = smoothstep(LITTER_RANGE.xx, LITTER_RANGE.yy, litter.xy) * loose;
  // Thinner in patches, so the grass and the forest floor show through (never one uniform carpet).
  masks *= mix(LITTER_THIN, 1.0, getVariantNoise(world.xz * 0.45 + 31.0));
  // The season (C1): more leaf litter under the broadleaf crowns in autumn and while they are bare.
  masks.y = min(masks.y * (1.0 + uSeasonLitter.a), 1.0) * (1.0 - themeWeights.y);
  return masks;
}

/**
 * One variant over the ground sample by its mask (height blended, noise broken edge). The fetches take explicit
 * gradients (dx, dy of the world xz, taken in uniform control flow): implicit derivatives inside this branch would
 * let the driver hoist every variant's fetches out of it (all four sampled on every pixel).
 */
void overlayGroundVariant(inout GroundSample ground, vec3 geometryNormal, vec2 xz, vec2 dx, vec2 dy, float layer,
  float scale, float mask, vec3 tint, float noise) {
  if (mask < 0.02) return;
  vec3 uv = vec3(VARIANT_TURN * xz * scale + layer * 0.37, layer);
  vec2 gradX = VARIANT_TURN * dx * scale;
  vec2 gradY = VARIANT_TURN * dy * scale;
  vec4 texel = textureGrad(uGroundAlbedo, uv, gradX, gradY);
  float edge = mask + (texel.a - 0.5) * ${glslLiteral(tuning.heightShare)} + (noise - 0.5) * ${glslLiteral(tuning.noiseShare)};
  float share = smoothstep(VARIANT_EDGE.x, VARIANT_EDGE.y, edge);
  if (share <= 0.0) return;
  ground.albedo = mix(ground.albedo, min(texel.rgb * tint, vec3(1.0)), share);
#ifdef GROUND_VARIANT_NORMALS
  vec4 raw = textureGrad(uGroundNormal, uv, gradX, gradY);
  vec2 slope = transpose(VARIANT_TURN) * (raw.rg * 2.0 - 1.0);
  vec3 normal = normalize(geometryNormal + groundTangentBasis(geometryNormal) * vec3(slope, 0.0) * 0.9);
  ground.normal = normalize(mix(ground.normal, normal, share));
  ground.occlusion = mix(ground.occlusion, raw.b, share);
  ground.roughness = mix(ground.roughness, raw.a, share);
#endif
}

/** Basalt tile share 0..1: the basalt palette's gentler rock and the grey apron of the gentle mountain rock. */
float getBasaltMask(GroundSample ground, GroundContext context, vec3 normal) {
  if (context.lava <= 0.0) return 0.0;
  float rock = clamp(ground.paletteShares.w + ground.mine, 0.0, 1.0);
  return rock * context.lava * smoothstep(BASALT_NORMAL.x, BASALT_NORMAL.y, normal.y);
}

/**
 * Tilled garden soil (editor paint): the island's dirt tile, darker and moist, in soft furrows that bend with a broad
 * noise (never ruler straight) and fade where a furrow gets smaller than a pixel. High tilts the normal across them.
 */
void applyTilledSoil(inout GroundSample ground, float mask, float rows, GroundContext context, vec3 geometryNormal,
  vec2 xz, vec2 dx, vec2 dy, float noise) {
  if (mask < 0.02) return;
  overlayGroundVariant(ground, geometryNormal, xz, dx, dy, TILLED_LAYER, VARIANT_SCALES.w, mask,
    context.soil * TILLED_SOIL, noise);
  float share = smoothstep(VARIANT_EDGE.x, VARIANT_EDGE.y, mask + (noise - 0.5) * ${glslLiteral(tuning.noiseShare)});
  float fade = 1.0 - smoothstep(TILLED_FADE.x, TILLED_FADE.y, max(length(dx), length(dy)));
  if (share * fade <= 0.0) return;
  // Crop plots keep their furrows along the field rows (world axes); painted gardens bend with a broad noise.
  float angle = (getVariantNoise(xz * 0.07 + 29.0) - 0.5) * 1.4 * (1.0 - rows);
  vec2 across = vec2(cos(angle), sin(angle));
  float phase = dot(xz, across) / ${glslLiteral(tuning.tilledSpacing)}
    + (getVariantNoise(xz * 0.8 + 3.0) - 0.5) * 0.35;
  float wave = sin(phase * 6.2832);
  float profile = smoothstep(-0.7, 0.85, wave);
  ground.albedo *= mix(1.0, mix(TILLED_SHADE.x, TILLED_SHADE.y, profile), share * fade);
#ifdef GROUND_VARIANT_NORMALS
  float slope = cos(phase * 6.2832) * ${glslLiteral(tuning.tilledTilt)} * share * fade;
  ground.normal = normalize(ground.normal - vec3(across.x, 0.0, across.y) * slope);
#endif
}

/**
 * Every detail over the sample: beach stones in the sand palette, scree in rock grey, salt flats white, tidal flats
 * grey mud, basalt on the basalt rock, wet rounded pebbles at rivers (sand palette on a shore), tilled soil.
 */
void applyGroundVariants(inout GroundSample ground, GroundDetail detail, GroundContext context, vec3 geometryNormal,
  vec2 xz, float signedDepth) {
  vec2 dx = dFdx(xz);
  vec2 dy = dFdy(xz);
  vec4 masks = detail.variants;
  vec2 litter = detail.litter;
  float most = max(max(max(masks.x, masks.y), max(masks.z, masks.w)),
    max(max(litter.x, litter.y), max(max(detail.basalt, detail.pebbles), detail.tilled)));
  if (most < 0.02) return;
  float noise = getVariantNoise(xz);
  // The crown litter first: moss, stones and mud lie over it.
  overlayGroundVariant(ground, geometryNormal, xz, dx, dy, LITTER_LAYERS.x, LITTER_SCALES.x, litter.x, vec3(1.0),
    noise);
  overlayGroundVariant(ground, geometryNormal, xz, dx, dy, LITTER_LAYERS.y, LITTER_SCALES.y, litter.y,
    LEAF_LITTER_TINT * (1.0 + uSeasonLitter.rgb), 1.0 - noise);
  overlayGroundVariant(ground, geometryNormal, xz, dx, dy, BASALT_LAYER, BASALT_SCALE, detail.basalt, vec3(1.0),
    noise);
  vec3 stones = mix(context.sand, VARIANT_SCREE_TINT * context.rock, detail.screeShare);
  float salt = smoothstep(VARIANT_SALT_HEIGHT.x, VARIANT_SALT_HEIGHT.y, -signedDepth);
  overlayGroundVariant(ground, geometryNormal, xz, dx, dy, VARIANT_LAYERS.x, VARIANT_SCALES.x, masks.x, stones, noise);
  overlayGroundVariant(ground, geometryNormal, xz, dx, dy, VARIANT_LAYERS.y, VARIANT_SCALES.y, masks.y,
    VARIANT_MOSS_TINT, noise);
  overlayGroundVariant(ground, geometryNormal, xz, dx, dy, VARIANT_LAYERS.z, VARIANT_SCALES.z, masks.z, vec3(1.0),
    noise);
  // Pebbles lie in the mud of the bank; the exposed river pebbles are wet (darker), shore pebbles take the sand.
  vec3 pebbles = mix(mix(vec3(1.0), PEBBLE_WET, smoothstep(-0.02, 0.05, -signedDepth)), context.sand,
    detail.pebbleShore);
  overlayGroundVariant(ground, geometryNormal, xz, dx, dy, PEBBLE_LAYER, PEBBLE_SCALE, detail.pebbles, pebbles,
    1.0 - noise);
  overlayGroundVariant(ground, geometryNormal, xz, dx, dy, VARIANT_LAYERS.w, VARIANT_SCALES.w, masks.w,
    mix(mix(VARIANT_CRACKED_TINT, context.soil, ${glslLiteral(tuning.crackedSoilShare)}), VARIANT_SALT_TINT, salt),
    noise);
  applyTilledSoil(ground, detail.tilled, detail.fieldRows, context, geometryNormal, xz, dx, dy, noise);
}
`;
