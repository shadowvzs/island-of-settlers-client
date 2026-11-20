import { MATERIAL } from "../../shared/world/world-data";
import {
  getMicroDetailCell,
  MICRO_CLASS,
  MICRO_CLASS_IDS,
  MICRO_CLASS_OF_MATERIAL
} from "../materials/micro-detail";
import { SNOW_MAP_GLSL } from "../snow-map";
import { SNOW_PALETTE_GLSL } from "../snow-palette";
import { TRAFFIC_WEAR_TUNING } from "../traffic-wear-tuning";
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
import { SEASON_GROUND_UNIFORMS_GLSL, SNOW_DISTRIBUTION_SHARE_GLSL } from "./season-ground-glsl";
import { TRAFFIC_WEAR_GLSL } from "./traffic-wear-glsl";

const WEIGHT_CHANNELS = ["weightA.x", "weightA.y", "weightA.z", "weightA.w", "weightB.x",
  "weightB.y", "weightB.z", "weightB.w", "weightC.x"];
const MICRO_WEIGHT_CHANNELS = ["weightsA.x", "weightsA.y", "weightsA.z", "weightsA.w", "weightsB.x",
  "weightsB.y", "weightsB.z", "weightsB.w", "weightsC.x"];
const LITE_MICRO_NAMES = ["grass", "soil", "grains", "snow"];
const LITE_MICRO_CELLS = MICRO_CLASS_IDS.map((id) => {
  const cell = getMicroDetailCell(MICRO_CLASS[id]);
  return `vec2(${cell.column.toFixed(1)}, ${cell.row.toFixed(1)})`;
});
const LITE_MICRO_SUMS = MICRO_CLASS_IDS.map((id) => {
  const name = LITE_MICRO_NAMES[MICRO_CLASS[id]];
  const channels = Object.entries(MICRO_CLASS_OF_MATERIAL)
    .filter(([, microClass]) => microClass === MICRO_CLASS[id])
    .map(([material]) => MICRO_WEIGHT_CHANNELS[Number(material)]!)
    .join(" + ");
  return `  float ${name} = ${channels};`;
});
const liteMicroCellGlsl = `
vec2 getLiteMicroCell(vec4 weightsA, vec4 weightsB, vec4 weightsC) {
  vec2 cell = ${LITE_MICRO_CELLS[0]};
${LITE_MICRO_SUMS.join("\n")}
  float best = grass;
  if (soil > best) { best = soil; cell = ${LITE_MICRO_CELLS[1]}; }
  if (grains > best) { best = grains; cell = ${LITE_MICRO_CELLS[2]}; }
  if (snow > best) { cell = ${LITE_MICRO_CELLS[3]}; }
  return cell;
}`;
const NOISE_CHANNELS = ["x", "y", "z", "w"];
const ROCK_LAYER = 5;
/** The apron gravel: the walls' fine grain (seen from the side). */
const MINE_LAYER = 8;
/** Directional art keeps its orientation (sand ripples, snow ripples, mine drag marks). */
const UNTURNED_LAYERS = new Set<number>([MATERIAL.sand, MATERIAL.snow, MATERIAL.mine]);
/** The full ground inverts the breakup noise from this layer on (dirt, sand, rock, ...). */
const INVERTED_BREAKUP_FROM = 4;

/** The full ground's layerTint per layer (the island palette follows the blend: applyGroundPalette). */
const LAYER_TINTS: Partial<Record<number, string>> = {
  [MATERIAL.grass]: "meadow",
  [MATERIAL.lushGrass]: "meadow",
  [MATERIAL.forestFloor]: "forest",
  [MATERIAL.snow]: "tintSummitSnow(LITE_SNOW_TONE, world)"
};

const getLayerTint = (layer: number) => LAYER_TINTS[layer] ?? "vec3(1.0)";

/** The full ground's per layer breakup noise, with constant channels (no dynamic indexing). */
const getLayerBreakup = (layer: number) => {
  const noise =
    `macro.breakup.${NOISE_CHANNELS[layer % 4]} * 0.55 + ` +
    `macro.grain.${NOISE_CHANNELS[(layer + 1) % 4]} * 0.45`;
  return layer < INVERTED_BREAKUP_FROM ? noise : `1.0 - (${noise})`;
};

/**
 * One unrolled layer call: every index is a literal, so no arrays and no loops. The rock layer
 * samples its wall projections and beds where the ground is a wall (MC-08).
 */
const createLayerCall = (units: number, layer: number) => {
  const textureLayer = layer.toFixed(1);
  const scale = (1 / units).toFixed(6);
  const allowTurn = UNTURNED_LAYERS.has(layer) ? "0.0" : "1.0";
  if (layer === ROCK_LAYER) {
    const gravelLayer = MINE_LAYER.toFixed(1);
    const gravelScale = (1 / MATERIAL_TILE_UNITS[MINE_LAYER]!).toFixed(6);
    return (
      `  addLiteRockLayer(albedo, surface, total, ${WEIGHT_CHANNELS[layer]}, ${textureLayer}, ${scale},\n` +
      `    ${gravelLayer}, ${gravelScale}, uv, dx, dy, ${getLayerBreakup(layer)}, wall, untile, ${allowTurn});`
    );
  }
  return (
    `  addLiteLayer(albedo, surface, total, ${WEIGHT_CHANNELS[layer]}, ${textureLayer}, ${scale},\n` +
    `    uv, dx, dy, ${getLayerTint(layer)}, ${getLayerBreakup(layer)}, untile, ${allowTurn});`
  );
};

/**
 * Lite ground: the fallback when the full ground shader does not compile or link (mobile
 * drivers; ground-shader-variant.ts). Same texture arrays, macro tint and light as the full ground,
 * written for weak shader compilers: no loops, no local arrays, no dynamic indexing, no integer
 * ops, one pass (a soft max of the height blended scores replaces the full ground's two passes).
 * It keeps only the gravel's side projections on rock walls (two fetches where a pixel is wall rock) and
 * drops the near detail normal, the snow and winter tints, the ore stain and the glints. Same
 * functions as GROUND_GLSL (sampleGround, lightGround).
 */
export const GROUND_LITE_GLSL = `
${GROUND_LAYERS_GLSL}
${GROUND_PALETTE_GLSL}
${COVER_FIELD_GLSL}
${TRAFFIC_WEAR_GLSL}
${GROUND_TANGENT_GLSL}
${MICRO_DETAIL_GLSL}
${GROUND_CLIFF_GLSL}
${SNOW_MAP_GLSL}
${SEASON_GROUND_UNIFORMS_GLSL}
${SNOW_DISTRIBUTION_SHARE_GLSL}

const vec3 LITE_SNOW_TONE = ${SNOW_PALETTE_GLSL.liteTone};
/** Soft max sharpness: a 0.12 lower score gets ~1/7 of the weight (full ground: a cut-off). */
const float LITE_BLEND_SHARPNESS = 24.0;

struct GroundSample {
  vec3 albedo;
  vec3 normal;
  float occlusion;
  float roughness;
  float wetDarken;
  /** Share of the mine layer; sand, soil, clover and rock shares (the splat weights): applyGroundPalette. */
  float mine;
  vec4 paletteShares;
};

${GROUND_MACRO_GLSL}

void addLiteLayer(
  inout vec3 albedo, inout vec4 surface, inout float total, float weight, float layer, float scale,
  vec2 uv, vec2 dx, vec2 dy, vec3 tint, float breakup, UntileFrame frame, float allowTurn
) {
  if (weight < 0.004) return;
  vec4 texel = sampleAlbedoUntiled(layer, uv * scale, dx * scale, dy * scale, frame, allowTurn);
  vec4 normalSample = sampleNormalUntiled(layer, uv * scale, dx * scale, dy * scale, frame, allowTurn);
  float relief = texel.a * 0.55 + (breakup - 0.5) * 0.8;
  float score = weight + relief * min(1.0, weight * 3.0);
  float share = exp2((score - 1.2) * LITE_BLEND_SHARPNESS);
  albedo += texel.rgb * tint * share;
  surface += normalSample * share;
  total += share;
}

/** Wall rock of the lite ground: where it is a wall, its side projections and beds. */
struct LiteWall {
  CliffBeds beds;
  float cliff;
  vec3 dx;
  vec3 dy;
  vec3 normal;
  vec3 world;
};

/** The rock tile seen from the side (two projections, blended by the wall normal). */
vec4 sampleLiteWall(float layer, float scale, LiteWall wall) {
  vec2 blend = pow(abs(wall.normal.xz), vec2(4.0));
  blend /= max(blend.x + blend.y, 1e-4);
  vec4 sideX = textureGrad(uGroundAlbedo, groundLayerUv(layer, wall.world.zy * scale), wall.dx.zy * scale,
    wall.dy.zy * scale);
  vec4 sideZ = textureGrad(uGroundAlbedo, groundLayerUv(layer, wall.world.xy * scale), wall.dx.xy * scale,
    wall.dy.xy * scale);
  return sideX * blend.x + sideZ * blend.y;
}

void addLiteRockLayer(
  inout vec3 albedo, inout vec4 surface, inout float total, float weight, float layer,
  float scale, float gravelLayer, float gravelScale, vec2 uv, vec2 dx, vec2 dy, float breakup,
  LiteWall wall, UntileFrame frame, float allowTurn
) {
  if (weight < 0.004) return;
  vec4 texel = sampleAlbedoUntiled(layer, uv * scale, dx * scale, dy * scale, frame, allowTurn);
  vec4 normalSample = sampleNormalUntiled(layer, uv * scale, dx * scale, dy * scale, frame, allowTurn);
  if (wall.cliff > 0.02) {
    vec4 gravel = sampleLiteWall(gravelLayer, gravelScale * CLIFF_GRAIN_SCALE, wall);
    texel = mix(texel, gravel, wall.cliff);
    texel.rgb = applyCliffBeds(texel.rgb, gravel.rgb, wall.beds, wall.cliff);
  }
  float relief = texel.a * 0.55 + (breakup - 0.5) * 0.8;
  float score = weight + relief * min(1.0, weight * 3.0);
  float share = exp2((score - 1.2) * LITE_BLEND_SHARPNESS);
  albedo += texel.rgb * share;
  surface += normalSample * share;
  total += share;
}
${liteMicroCellGlsl}

GroundSample sampleGround(
  vec3 world, vec4 weightsA, vec4 weightsB, vec4 weightsC, vec3 geometryNormal, float canopy, float dry
) {
  vec2 xz = world.xz;
  vec4 weightA = weightsA;
  vec4 weightB = weightsB;
  vec4 weightC = weightsC;
#ifdef SNOW_DISTRIBUTION
  float snowKeep = getSnowKeep(xz);
  float distributionShare = getSnowDistributionShare();
  float movedSnow = weightB.z * (1.0 - snowKeep) * distributionShare;
  weightB.z -= movedSnow;
  float grassWeight = weightA.x + weightA.y;
  float dirtWeight = weightA.w;
  float stoneWeight = weightB.y + weightC.x;
  vec3 returnShares = getSnowReturnShares(grassWeight, dirtWeight, stoneWeight);
  weightA.x += movedSnow * returnShares.x;
  weightA.w += movedSnow * returnShares.y;
  float stoneGain = 1.0 + movedSnow * returnShares.z / max(stoneWeight, 1e-4);
  weightB.y *= stoneGain;
  weightC.x *= stoneGain;
#endif
  vec2 worldDx = dFdx(xz);
  vec2 worldDy = dFdy(xz);
  float cliff = getCliffShare(geometryNormal);
  CliffBeds noBeds = CliffBeds(0.5, 0.0);
  LiteWall wall = LiteWall(noBeds, cliff, dFdx(world), dFdy(world), geometryNormal, world);
  if (cliff > 0.02 && weightB.y > 0.004) wall.beds = getCliffBeds(world);
  else wall.cliff = 0.0;
  GroundMacro macro = sampleGroundMacro(xz, max(length(worldDx), length(worldDy)));
  UntileFrame untile = getUntileFrame(macro.patches.w);
  vec2 uv = xz + (macro.patches.xy - 0.5) * 3.0;
  vec2 dx = worldDx;
  vec2 dy = worldDy;
  vec3 meadow = meadowTint(macro, canopy, dry);
#ifdef SNOW_DISTRIBUTION
  meadow = mix(meadow, vec3(1.25, 1.08, 0.66), (1.0 - snowKeep) * 0.6 * distributionShare);
#endif
  vec3 forest = vec3(mix(1.0, 0.82, canopy));
  vec3 albedo = vec3(0.0);
  vec4 surface = vec4(0.0);
  float total = 0.0;
${MATERIAL_TILE_UNITS.map(createLayerCall).join("\n")}
  float norm = 1.0 / max(total, 1e-30);
  albedo *= norm * mix(0.9, 1.08, macro.region.w);
  surface *= norm;
  float lawn = sampleLawnDepth(xz, clamp(weightsA.x + weightsA.y + weightsA.z, 0.0, 1.0));
  albedo *= mix(vec3(1.0), uLawnDepth.rgb, lawn);
  surface.z *= mix(1.0, uLawnDepth.w, lawn);
  // Lite drops the winter forest tint, so the explicit snow layer is its snow coverage. Splat
  // weights are already normalized (0..1); total here is the softmax share sum, not a weight sum.
  float snowCover = clamp(weightB.z, 0.0, 1.0);
  float summitSnow = snowCover * getSummitSnowShare(world.y);
  // Summit snow is not walked: wear patches of the ground below never show through it.
  float wear = sampleLiteTrafficWear(xz, macro.breakup.x, snowCover) * (1.0 - summitSnow);
  vec3 cleanSnow = tintSummitSnow(SUMMIT_SNOW_CLEAN_TONE * LITE_SNOW_TONE, world);
  albedo = mix(albedo, cleanSnow, summitSnow * SUMMIT_SNOW_CLEAN);
  applySummitSnowLayer(albedo, surface, summitSnow, 0.0);
  albedo = applyTrafficWear(albedo, wear, snowCover);
  surface.xy *= 1.0 - wear * mix(0.45, ${TRAFFIC_WEAR_TUNING.snowSmooth.toFixed(4)}, snowCover);
  float footprint = max(length(worldDx), length(worldDy));
  float near = 1.0 - smoothstep(0.005, 0.011, footprint);
  if (near > 0.0) {
    applyMicroDetail(albedo, surface,
      sampleMicroDetail(getLiteMicroCell(weightsA, weightsB, weightsC), xz, worldDx, worldDy), near);
  }
  float bumpStrength = mix(0.95, 0.6, macro.far) * (1.0 - cliff * 0.6);
  vec3 normal = normalize(geometryNormal +
    groundTangentBasis(geometryNormal) * vec3(surface.x, surface.y, 0.0) * bumpStrength);
  return GroundSample(albedo, normal, surface.z, surface.w, GROUND_WET_DARKEN, weightC.x,
    vec4(weightB.x, weightA.w, weightA.y, weightB.y));
}

vec3 getGroundSparkle(GroundSample ground, vec2 xz, float visibility) {
  return vec3(0.0);
}

/** Minimal draws no bloom, so its noon snow never clips: no roll-off. */
vec3 rollOffGroundHighlights(GroundSample ground, vec3 color) {
  return color;
}
${GROUND_LIGHT_GLSL}
`;
