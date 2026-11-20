import { PREVAILING_WIND_DIRECTION } from "../../shared/world/prevailing-wind";
import { MATERIAL } from "../../shared/world/world-data";
import { getMicroDetailCell, MICRO_CLASS_OF_MATERIAL } from "../materials/micro-detail";
import { ORE_CODE_STEP } from "../mine-field";
import { SNOW_MAP_GLSL } from "../snow-map";
import { SNOW_NOON_ROLL_OFF, SNOW_PALETTE_GLSL } from "../snow-palette";
import { TRAFFIC_WEAR_TUNING } from "../traffic-wear-tuning";
import { glslLiteral } from "./glsl-literal";
import { GROUND_CLIFF_GLSL } from "./ground-cliff-glsl";
import {
  COVER_FIELD_GLSL,
  GROUND_LAYERS_GLSL,
  GROUND_LIGHT_GLSL,
  GROUND_MACRO_GLSL,
  GROUND_TANGENT_GLSL,
  MATERIAL_TILE_UNITS,
  MICRO_DETAIL_GLSL
} from "./ground-common-glsl";
import { GROUND_PALETTE_GLSL } from "./ground-palette-glsl";
import { GROUND_PARALLAX_GLSL, PARALLAX_RELIEF_WEIGHTS_GLSL } from "./ground-parallax-glsl";
import { MINE_GLSL } from "./mine-glsl";
import { SEASON_GROUND_UNIFORMS_GLSL, SNOW_DISTRIBUTION_SHARE_GLSL } from "./season-ground-glsl";
import { TRAFFIC_TREAD_GLSL, TRAFFIC_WEAR_GLSL } from "./traffic-wear-glsl";

const LAYER_COUNT = MATERIAL_TILE_UNITS.length;
/** Layer blend band shared by the GLSL ground and the TSL terrain twin. */
export const GROUND_BLEND_DEPTH = 0.12;
export const SUMMIT_SNOW_BLEND_DEPTH = 0.12;

/**
 * Second, coarser and turned octave of the wall rock: scale against the rock tile, its share and
 * the turn (column-major mat2). Shared by the GLSL and its TSL twin (tsl/terrain.ts).
 */
export const ROCK_MACRO = { scale: 0.41, share: 0.38, turn: [0.6, 0.8, -0.8, 0.6] } as const;
/** The tile scales are packed into a mat3 (see materialScale), so there must be nine layers. */
if (LAYER_COUNT !== 9) throw new Error(`ground GLSL packs 9 layer scales, got ${LAYER_COUNT}`);

const toFloatList = (values: number[]) => values.map((value) => value.toFixed(6)).join(", ");

const microCellGlsl = `
vec2 microCell(int layer) {
${Object.values(MATERIAL).map((material) => {
  const cell = getMicroDetailCell(MICRO_CLASS_OF_MATERIAL[material]!);
  return `  if (layer == ${material}) return vec2(${cell.column.toFixed(1)}, ${cell.row.toFixed(1)});`;
}).join("\n")}
  return vec2(0.0);
}`;

/**
 * Ground material set (needs NOISE_GLSL and LIGHTING_GLSL). Nine PBR layers from two texture arrays
 * (albedo + height, normal + AO + roughness), three detail scales:
 * - macro: world space noise (regions, patches) tints the meadows, dry patches, darker grass
 *   under the canopy; it never repeats and gets stronger with distance, so the far camera reads
 *   colour regions instead of texture noise;
 * - medium: the painted tiles (tufts, stones, leaves, roots) with height blended transitions
 *   broken up by two noise scales (patches of ~2 units, grain of ~0.5 units), so borders look
 *   grown instead of drawn and never follow the cell grid or the mesh triangles;
 * - micro: near the camera the dominant layer's micro tile (T06a atlas) adds grain, relief and cavity.
 * Snowfields get wind ripples, drifts and cool lee sides (never flat pure white); in winter areas
 * (the snow map) the forest floor is snow with needle litter, without glitter.
 * Mine ground carries its ore (splatC, mine-field.ts): a faint ore stain once surveyed and the
 * twinkling mineral glints of mine-glsl.ts.
 */
export const GROUND_GLSL = `
${GROUND_LAYERS_GLSL}
${GROUND_PALETTE_GLSL}
${COVER_FIELD_GLSL}
${TRAFFIC_WEAR_GLSL}
${TRAFFIC_TREAD_GLSL}
${GROUND_TANGENT_GLSL}
${MICRO_DETAIL_GLSL}
${MINE_GLSL}
${SNOW_MAP_GLSL}
${SEASON_GROUND_UNIFORMS_GLSL}
${SNOW_DISTRIBUTION_SHARE_GLSL}
${GROUND_CLIFF_GLSL}

const int LAYER_COUNT = ${LAYER_COUNT};
/**
 * Tile scale per layer, packed in a mat3 instead of a float[9] constant: Mali compilers reject
 * array constructors ("no default precision defined for variable 'float[9]'").
 */
const mat3 MATERIAL_SCALES = mat3(${toFloatList(MATERIAL_TILE_UNITS.map((units) => 1 / units))});
const float ORE_CODE_STEP = ${ORE_CODE_STEP.toFixed(1)};
const float BLEND_DEPTH = ${glslLiteral(GROUND_BLEND_DEPTH)};
/** Extra blend depth where summit snow meets rock: a soft, grainy edge instead of a cut line. */
const float SUMMIT_SNOW_BLEND_DEPTH = ${glslLiteral(SUMMIT_SNOW_BLEND_DEPTH)};
const int LAWN_LAYER = ${MATERIAL.grass};
const int CLOVER_LAYER = ${MATERIAL.lushGrass};
const int FOREST_LAYER = 2;
const int DIRT_LAYER = ${MATERIAL.dirt};
const int ROCK_LAYER = 5;
const int SNOW_LAYER = 6;
const int MINE_LAYER = 8;
const int SAND_LAYER = ${MATERIAL.sand};
/** Prevailing wind over the snow (the rock snow drifts use the same direction). */
const vec2 SNOW_DRIFT_WIND = vec2(${PREVAILING_WIND_DIRECTION.x.toFixed(4)}, ${PREVAILING_WIND_DIRECTION.z.toFixed(4)});
const vec3 SNOW_SHADE = ${SNOW_PALETTE_GLSL.groundShade};
const vec3 NEEDLE_LITTER = vec3(0.26, 0.25, 0.2);
/** Second, coarser and turned octave of the wall rock (breaks the tile repeat on tall faces). */
const float ROCK_MACRO_SCALE = ${glslLiteral(ROCK_MACRO.scale)};
const float ROCK_MACRO_SHARE = ${glslLiteral(ROCK_MACRO.share)};
const mat2 ROCK_MACRO_TURN = mat2(${ROCK_MACRO.turn.map(glslLiteral).join(", ")});

struct GroundSample {
  vec3 albedo;
  vec3 normal;
  float occlusion;
  float roughness;
  /** Share of the snow layer. */
  float snow;
  /** 0 lowland .. 1 upper massif (summit snow glitter). */
  float summit;
  /** Share of the mine layer, its ore (ORE code, 0 unsurveyed) and the ore left 0..1. */
  float mine;
  float glint;
  int ore;
  float oreAmount;
  /** Albedo factor of saturated ground here (the sand palette's own; applyGroundWetness). */
  float wetDarken;
  /**
   * Blend shares of the sand, the soil (dirt), the clover meadow and the rock: the palette is applied after the
   * blend.
   */
  vec4 paletteShares;
};

${GROUND_MACRO_GLSL}

float materialScale(int layer) {
  return MATERIAL_SCALES[layer / 3][layer % 3];
}

/** Texture array layer of a material (base materials: their id; see GROUND_LAYER_COUNT). */
float groundLayer(int layer) {
  return float(layer);
}

vec3 layerUv(int layer, vec2 uv) {
  return groundLayerUv(groundLayer(layer), uv);
}

/** Directional art (sand ripples, snow ripples, mine drag marks) keeps its orientation. */
float layerTurn(int layer) {
  return layer == SAND_LAYER || layer == SNOW_LAYER || layer == MINE_LAYER ? 0.0 : 1.0;
}

/**
 * Snowfield tone: wind ripples (sastrugi) across the drift direction, bright drifts and duller
 * scoured patches, a faint grain, and cool blue on lee slopes and in low hollows; a little below
 * pure white overall.
 */
vec3 snowTint(GroundMacro macro, vec2 xz, vec3 normal) {
  float warp = (macro.patches.x - 0.5) * 5.0 + (macro.region.z - 0.5) * 9.0;
  float ripples = sin(dot(xz, SNOW_DRIFT_WIND) * 1.7 + warp) * 0.5 + 0.5;
  float drifts = smoothstep(0.3, 0.8, macro.region.y);
  float tone = 0.8 + drifts * 0.07 - ripples * (0.035 + macro.breakup.x * 0.045)
    + (macro.grain.y - 0.5) * 0.04;
  vec2 downhill = normal.xz / max(length(normal.xz), 0.001);
  float lee = max(dot(downhill, SNOW_DRIFT_WIND), 0.0) * smoothstep(0.02, 0.3, 1.0 - normal.y);
  float hollow = smoothstep(0.45, 0.2, macro.patches.y);
  return vec3(tone) * mix(vec3(1.0), SNOW_SHADE, clamp(lee * 2.5 + hollow * 0.3, 0.0, 0.6));
}

/**
 * Tint of a layer: the meadow tint on the lawn and the clover meadow, the canopy shade on the forest floor.
 * The island palette (sand, soil, clover, mine/apron) is applied to the blended sample by applyGroundPalette:
 * a per-pixel context inside the layer loops raised the register pressure of this fetch-bound shader (+0.4 ms
 * High world pass, lane/ground-palette TOOL-4).
 */
vec3 layerTint(int layer, float canopy, vec3 meadow) {
  if (layer <= CLOVER_LAYER) return meadow;
  if (layer == FOREST_LAYER) return vec3(mix(1.0, 0.82, canopy));
  return vec3(1.0);
}

/**
 * Forest floor in a winter area: snow with dark needle litter where the painted litter is dark,
 * and darker, thinner snow under the dense canopy (the conifer shade).
 */
vec3 getWinterForestFloor(vec3 litter, float winter, float canopy, vec3 snow) {
  float dark = smoothstep(0.32, 0.12, dot(litter, vec3(0.3, 0.59, 0.11)));
  vec3 snowFloor = mix(snow * 0.92, NEEDLE_LITTER, dark * 0.6) * mix(1.0, 0.78, canopy);
  return mix(litter, snowFloor, winter);
}

vec3 getLayerAlbedo(int layer, vec3 texel, float canopy, vec3 meadow, vec3 snow, float winter) {
  if (layer == SNOW_LAYER) return texel * snow;
  vec3 tinted = texel * layerTint(layer, canopy, meadow);
  if (layer != FOREST_LAYER || winter <= 0.0) return tinted;
  return getWinterForestFloor(tinted, winter, canopy, snow);
}

/** One side projection of the wall rock: the tile mixed with a coarser, turned octave of itself. */
vec4 sampleRockSide(vec2 uv, vec2 dx, vec2 dy, float scale) {
  vec4 near = textureGrad(uGroundAlbedo, layerUv(ROCK_LAYER, uv * scale), dx * scale, dy * scale);
  vec2 macroUv = ROCK_MACRO_TURN * uv * (scale * ROCK_MACRO_SCALE) + 0.37;
  float macroGrad = scale * ROCK_MACRO_SCALE;
  vec4 far = textureGrad(uGroundAlbedo, layerUv(ROCK_LAYER, macroUv),
    ROCK_MACRO_TURN * dx * macroGrad, ROCK_MACRO_TURN * dy * macroGrad);
  return mix(near, far, ROCK_MACRO_SHARE);
}

/** Blend of three planar projections (x, top, z) by the surface normal. */
vec3 getPlanarBlend(vec3 normal) {
  vec3 blend = pow(abs(normal), vec3(4.0));
  return blend / (blend.x + blend.y + blend.z);
}

/**
 * The apron gravel on a wall (three planar projections, so oblique faces do not stretch the
 * stones), coarser than on the ground: the walls' fine grain.
 */
vec3 sampleWallGravel(vec3 world, vec3 blend, vec3 dx, vec3 dy) {
  float scale = materialScale(MINE_LAYER) * CLIFF_GRAIN_SCALE;
  vec3 sideX = textureGrad(uGroundAlbedo, layerUv(MINE_LAYER, world.zy * scale), dx.zy * scale,
    dy.zy * scale).rgb;
  vec3 top = textureGrad(uGroundAlbedo, layerUv(MINE_LAYER, world.xz * scale), dx.xz * scale,
    dy.xz * scale).rgb;
  vec3 sideZ = textureGrad(uGroundAlbedo, layerUv(MINE_LAYER, world.xy * scale), dx.xy * scale,
    dy.xy * scale).rgb;
  return sideX * blend.x + top * blend.y + sideZ * blend.z;
}

/** Rock seen from the side on steep slopes: three planar projections blended by the normal. */
vec4 sampleRockTriplanar(vec3 world, vec3 normal, vec4 top, vec3 dx, vec3 dy) {
  vec3 blend = getPlanarBlend(normal);
  if (blend.y > 0.98) return top;
  float scale = materialScale(ROCK_LAYER);
  vec4 sideX = sampleRockSide(world.zy, dx.zy, dy.zy, scale);
  vec4 sideZ = sampleRockSide(world.xy, dx.xy, dy.xy, scale);
  return top * blend.y + sideX * blend.x + sideZ * blend.z;
}

/** Relief of a wall from the gravel tile's normals in the same three projections (bent per plane). */
vec3 sampleWallNormal(vec3 world, vec3 blend, vec3 dx, vec3 dy) {
  float scale = materialScale(MINE_LAYER) * CLIFF_GRAIN_SCALE;
  vec2 sideX = textureGrad(uGroundNormal, layerUv(MINE_LAYER, world.zy * scale), dx.zy * scale,
    dy.zy * scale).rg * 2.0 - 1.0;
  vec2 top = textureGrad(uGroundNormal, layerUv(MINE_LAYER, world.xz * scale), dx.xz * scale,
    dy.xz * scale).rg * 2.0 - 1.0;
  vec2 sideZ = textureGrad(uGroundNormal, layerUv(MINE_LAYER, world.xy * scale), dx.xy * scale,
    dy.xy * scale).rg * 2.0 - 1.0;
  return vec3(0.0, sideX.y, sideX.x) * blend.x + vec3(top.x, 0.0, top.y) * blend.y
    + vec3(sideZ.x, sideZ.y, 0.0) * blend.z;
}

/** Element by element: Mali compilers reject a float[9] array constructor. */
void setLayerWeights(out highp float weights[LAYER_COUNT], vec4 a, vec4 b, vec4 c) {
  weights[0] = a.x;
  weights[1] = a.y;
  weights[2] = a.z;
  weights[3] = a.w;
  weights[4] = b.x;
  weights[5] = b.y;
  weights[6] = b.z;
  weights[7] = b.w;
  weights[8] = c.x;
}
${GROUND_PARALLAX_GLSL}
${microCellGlsl}

GroundSample sampleGround(
  vec3 world, vec4 weightsA, vec4 weightsB, vec4 weightsC, vec3 geometryNormal, float canopy, float dry
) {
  vec2 xz = world.xz;
  highp float weights[LAYER_COUNT];
  setLayerWeights(weights, weightsA, weightsB, weightsC);
#ifdef SNOW_DISTRIBUTION
  float snowKeep = getSnowKeep(xz);
  float distributionShare = getSnowDistributionShare();
  float movedSnow = weights[SNOW_LAYER] * (1.0 - snowKeep) * distributionShare;
  weights[SNOW_LAYER] -= movedSnow;
  float grassWeight = weights[0] + weights[1] + weights[2];
  float dirtWeight = weights[3];
  float stoneWeight = weights[ROCK_LAYER] + weights[MINE_LAYER];
  vec3 returnShares = getSnowReturnShares(grassWeight, dirtWeight, stoneWeight);
  weights[0] += movedSnow * returnShares.x;
  weights[3] += movedSnow * returnShares.y;
  float stoneGain = 1.0 + movedSnow * returnShares.z / max(stoneWeight, 1e-4);
  weights[ROCK_LAYER] *= stoneGain;
  weights[MINE_LAYER] *= stoneGain;
#endif
  int ore = int(weightsC.y * 255.0 / ORE_CODE_STEP + 0.5);
  vec3 worldDx = dFdx(world);
  vec3 worldDy = dFdy(world);
  float footprint = max(length(worldDx.xz), length(worldDy.xz));
  GroundMacro macro = sampleGroundMacro(xz, footprint);
  UntileFrame untile = getUntileFrame(macro.patches.w);
  vec2 uv = xz + (macro.patches.xy - 0.5) * 3.0;
  vec2 dx = worldDx.xz;
  vec2 dy = worldDy.xz;
  vec2 detailXz = xz;
#ifdef GROUND_PARALLAX
  vec2 parallax = getGroundParallax(${PARALLAX_RELIEF_WEIGHTS_GLSL}, world, uv, dx, dy,
    min(length(worldDx.xz), length(worldDy.xz)), untile);
  uv += parallax;
  detailXz += parallax;
#endif
  float cliff = getCliffShare(geometryNormal);
  bool walls = cliff > 0.02 && weights[ROCK_LAYER] > 0.004;
  CliffBeds beds = CliffBeds(0.5, 0.0);
  vec3 wallBlend = vec3(0.0);
  vec3 wallGravel = vec3(0.0);
  if (walls) {
    beds = getCliffBeds(world);
    wallBlend = getPlanarBlend(geometryNormal);
    wallGravel = sampleWallGravel(world, wallBlend, worldDx, worldDy);
  }
  float summit = getSummitSnowShare(world.y);
  highp vec4 texels[LAYER_COUNT];
  highp float scores[LAYER_COUNT];
  float best = -1.0;
  int dominant = 0;
  for (int layer = 0; layer < LAYER_COUNT; layer++) {
    scores[layer] = -1.0;
    if (weights[layer] < 0.004) continue;
    float scale = materialScale(layer);
    texels[layer] = sampleAlbedoUntiled(groundLayer(layer), uv * scale, dx * scale, dy * scale,
      untile, layerTurn(layer));
    if (layer == SNOW_LAYER)
      texels[layer].rgb = mix(texels[layer].rgb, SUMMIT_SNOW_CLEAN_TONE, summit * SUMMIT_SNOW_CLEAN);
    if (layer == ROCK_LAYER) {
      texels[layer] = sampleRockTriplanar(world, geometryNormal, texels[layer], worldDx, worldDy);
      if (walls) texels[layer].rgb = applyCliffBeds(texels[layer].rgb, wallGravel, beds, cliff);
    }
    float noise = macro.breakup[layer & 3] * 0.55 + macro.grain[(layer + 1) & 3] * 0.45;
    float breakup = layer < 4 ? noise : 1.0 - noise;
    float relief = texels[layer].a * 0.55 + (breakup - 0.5) * 0.8;
    // Height-based edge (SNOW-LAYER): summit snow fills the rock's hollows first and the rock's
    // ridges poke through, instead of a uniform grey mix along the edge.
    if (layer == SNOW_LAYER && weights[ROCK_LAYER] >= 0.004)
      relief = mix(relief, (1.0 - texels[ROCK_LAYER].a) * 0.75 + (breakup - 0.5) * 0.4, summit);
    scores[layer] = weights[layer] + relief * min(1.0, weights[layer] * 3.0);
    if (scores[layer] > best) dominant = layer;
    best = max(best, scores[layer]);
  }
  vec3 meadow = meadowTint(macro, canopy, dry);
#ifdef SNOW_DISTRIBUTION
  meadow = mix(meadow, vec3(1.25, 1.08, 0.66), (1.0 - snowKeep) * 0.6 * distributionShare);
#endif
  vec3 snow = tintSummitSnow(snowTint(macro, xz, geometryNormal), world);
  float winter = weights[FOREST_LAYER] > 0.004 ? getSnowMap(xz) : 0.0;
#ifdef SNOW_DISTRIBUTION
  winter *= snowKeep;
#endif
  vec3 albedo = vec3(0.0);
  vec4 surface = vec4(0.0);
  float total = 0.0;
  float snowShare = 0.0;
  float forestShare = 0.0;
  float mineShare = 0.0;
  float rockShare = 0.0;
  vec4 paletteShares = vec4(0.0);
  float blendDepth = BLEND_DEPTH + SUMMIT_SNOW_BLEND_DEPTH * summit * step(0.004, weights[SNOW_LAYER]);
  for (int layer = 0; layer < LAYER_COUNT; layer++) {
    float contribution = max(scores[layer] - (best - blendDepth), 0.0);
    if (contribution <= 0.0) continue;
    float scale = materialScale(layer);
    vec4 normalSample = sampleNormalUntiled(groundLayer(layer), uv * scale, dx * scale, dy * scale,
      untile, layerTurn(layer));
    vec3 layerAlbedo = getLayerAlbedo(layer, texels[layer].rgb, canopy, meadow, snow, winter);
    albedo += layerAlbedo * contribution;
    surface += normalSample * contribution;
    total += contribution;
    if (layer == SNOW_LAYER) snowShare = contribution;
    if (layer == FOREST_LAYER) forestShare = contribution;
    if (layer == MINE_LAYER) mineShare = contribution;
    if (layer == ROCK_LAYER) rockShare = contribution;
    if (layer == SAND_LAYER) paletteShares.x = contribution;
    if (layer == DIRT_LAYER) paletteShares.y = contribution;
    if (layer == CLOVER_LAYER) paletteShares.z = contribution;
  }
  albedo /= total;
  mineShare /= total;
  paletteShares.w = rockShare;
  paletteShares /= total;
  // The forest floor gets the winter snow mix without living in the snow layer; include its
  // snow-map coverage so its footprints read as snow prints too.
  float snowCover = clamp((snowShare + forestShare * winter) / max(total, 1e-30), 0.0, 1.0);
  float summitSnow = summit * snowShare / total;
  // Ore stains of mine zones are ground marks: snow lying on them hides them.
  albedo *= mix(getOreStain(ore, mineShare, weightsC.z, macro.patches.y), vec3(1.0), summitSnow);
  surface /= total;
  float near = 1.0 - smoothstep(0.005, 0.011, footprint);
  if (near > 0.0) {
    applyMicroDetail(albedo, surface,
      sampleMicroDetail(microCell(dominant), detailXz, worldDx.xz, worldDy.xz), near);
  }
  applySummitSnowLayer(albedo, surface, summitSnow, 1.0);
  albedo *= mix(mix(0.9, 1.08, macro.region.w), 1.0, summitSnow);
  float lawn = sampleLawnDepth(xz, clamp(weightsA.x + weightsA.y + weightsA.z, 0.0, 1.0));
  albedo *= mix(vec3(1.0), uLawnDepth.rgb, lawn);
  surface.z *= mix(1.0, uLawnDepth.w, lawn);
  // Summit snow is not walked: wear patches of the ground below never show through it.
  vec2 tread = sampleTrafficTread(xz, footprint, snowCover) * (1.0 - summitSnow);
  albedo = applyTrafficPrints(applyTrafficWear(albedo, tread.x, snowCover), tread.y, snowCover,
    worldDx.xz, worldDy.xz, paletteShares.x);
  surface.xy *= 1.0 - tread.x * mix(0.45, ${TRAFFIC_WEAR_TUNING.snowSmooth.toFixed(4)}, snowCover);
  surface.xy *= 1.0 - tread.y * snowCover * ${TRAFFIC_WEAR_TUNING.snowPrintSmooth.toFixed(4)};
  surface.z *= 1.0 - tread.y * TRAFFIC_PRINT_OCCLUSION;
  // The layer normals are painted top down: on walls the gravel's planar normals replace them.
  float bumpStrength = mix(0.95, 0.6, macro.far) * (1.0 - cliff * (walls ? 1.0 : 0.6));
  vec3 normal = normalize(geometryNormal +
    groundTangentBasis(geometryNormal) * vec3(surface.x, surface.y, 0.0) * bumpStrength);
  if (walls) {
    float wallRock = cliff * rockShare / total;
    normal = normalize(normal + sampleWallNormal(world, wallBlend, worldDx, worldDy) * wallRock);
  }
  return GroundSample(
    albedo, normal, surface.z, surface.w, snowShare / total, summit, mineShare,
    step(0.999, weightsC.w), ore, weightsC.z, GROUND_WET_DARKEN, paletteShares
  );
}

/** Crystal size of the summit snow glints (noise cells per world unit), facet spread and strength. */
const float SNOW_GLITTER_SCALE = 14.0;
const float SNOW_GLITTER_SPREAD = 0.55;
const float SNOW_GLITTER = 0.35;

/**
 * View-dependent snow glints (after Wang & Bowles, EGSR 2016, simplified): every noise cell is a
 * crystal facet tilted randomly around the surface normal; it flashes only where it mirrors the sun
 * into the eye, so the glints move with the camera. Faded out where a crystal is smaller than a
 * pixel (no shimmer at iso distance) and scaled by the Highlights / glare setting. Summit snow only.
 */
vec3 getSnowGlitter(GroundSample ground, vec2 xz, float visibility) {
  float amount = ground.snow * ground.summit * visibility;
  if (amount <= 0.0) return vec3(0.0);
  float resolved = 1.0 - smoothstep(0.04, 0.12, length(fwidth(xz)) * SNOW_GLITTER_SCALE);
  if (resolved <= 0.0) return vec3(0.0);
  vec4 crystal = textureLod(uNoiseTexture, xz * SNOW_GLITTER_SCALE / NOISE_LATTICE, 0.0);
  vec3 facet = normalize(ground.normal + (crystal.rgb - 0.5) * 2.0 * SNOW_GLITTER_SPREAD);
  float mirror = dot(facet, normalize(uSunDirection + uViewDirection));
  float sparse = smoothstep(0.55, 0.7, crystal.a);
  return uSunColor * smoothstep(0.992, 0.999, mirror) * sparse * amount * resolved * SNOW_GLITTER * uHighlight;
}

/** Mineral glints on usable mine-zone ground; summit snow glitters faintly. */
vec3 getGroundSparkle(GroundSample ground, vec2 xz, float visibility) {
  return getMineGlint(ground.mine * ground.glint, ground.ore, ground.oreAmount, xz, visibility)
    + getSnowGlitter(ground, xz, visibility);
}
/** Sun height (uSunDirection.y) where the noon snow roll-off starts and is complete. */
const vec2 SNOW_NOON_SUN = vec2(
  ${SNOW_NOON_ROLL_OFF.sunStart.toFixed(3)}, ${SNOW_NOON_ROLL_OFF.sunFull.toFixed(3)});
const float SNOW_NOON_KNEE = ${SNOW_NOON_ROLL_OFF.knee.toFixed(3)};
const float SNOW_NOON_CEILING = ${SNOW_NOON_ROLL_OFF.ceiling.toFixed(3)};

/**
 * Noon snow roll-off (D-W4): under a high sun the lit lowland snow is compressed above a knee towards
 * a ceiling (luminance, hue kept), so it neither clips nor feeds the day bloom's clipped-white boost.
 * A low sun (dawn, dusk) and summit snow keep their light unchanged. Strategic and cinematic views
 * only: the possession weight (uExplorationFog, 1 in the possessed eye and its spyglass) fades it out.
 */
vec3 rollOffGroundHighlights(GroundSample ground, vec3 color) {
  float noon = smoothstep(SNOW_NOON_SUN.x, SNOW_NOON_SUN.y, uSunDirection.y);
  float weight = ground.snow * (1.0 - ground.summit) * noon * (1.0 - uExplorationFog);
  if (weight <= 0.0) return color;
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  if (luma <= SNOW_NOON_KNEE) return color;
  float excess = luma - SNOW_NOON_KNEE;
  float rolled = SNOW_NOON_KNEE + excess / (1.0 + excess / (SNOW_NOON_CEILING - SNOW_NOON_KNEE));
  return color * mix(1.0, rolled / luma, weight);
}
${GROUND_LIGHT_GLSL}
`;
