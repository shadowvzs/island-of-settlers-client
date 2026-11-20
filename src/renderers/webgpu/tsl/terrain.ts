import type { IUniform } from "three";
import {
  attribute,
  cameraPosition,
  clamp,
  dot,
  float,
  floor,
  Fn,
  fract,
  length,
  max,
  min,
  mix,
  normalize,
  positionWorld,
  sin,
  smoothstep,
  step,
  texture,
  vec2,
  vec3,
  vec4
} from "three/tsl";
import { type Material, MeshBasicNodeMaterial, type Texture } from "three/webgpu";

import {
  getMicroDetailCell,
  MICRO_CLASS_OF_MATERIAL,
  MICRO_DETAIL_COLUMNS,
  MICRO_DETAIL_INNER,
  MICRO_DETAIL_PAD,
  MICRO_DETAIL_ROWS,
  MICRO_DETAIL_UNITS
} from "../../../render-common/materials/micro-detail";
import { SUMMIT_SNOW_CLEAN, SUMMIT_SNOW_FLOOR } from "../../../render-common/shaders/ground-cliff-glsl";
import { GROUND_CLIMATE_TUNING } from "../../../render-common/shaders/ground-climate-glsl";
import { MATERIAL_TILE_UNITS } from "../../../render-common/shaders/ground-common-glsl";
import { SUMMIT_SNOW_BLEND_DEPTH } from "../../../render-common/shaders/ground-glsl";
import { GROUND_CONTEXT_TUNING } from "../../../render-common/shaders/ground-palette-glsl";
import { GROUND_VARIANT_TUNING } from "../../../render-common/shaders/ground-variant-layers-glsl";
import { TRAFFIC_WEAR_TUNING } from "../../../render-common/traffic-wear-tuning";
import { MATERIAL } from "../../../shared/world/world-data";
import { createFogNodes } from "./fog";
import { createLiveFogSampler } from "./live-fog";
import { createNoiseNodes } from "./noise";
import { sunShadowAt } from "./sun-shadow";
import { createSurfaceAir, createSurfaceColorTail } from "./surface-output";
import {
  applyTslDuneGrass, applyTslHeather, applyTslJungleFloor, applyTslTidalSilt, applyTslWrackLine, getTslTidalFlat
} from "./terrain-climate";
import { applySummitSnowLayer, arraySample, sampleWallRock } from "./terrain-rock";
import { applyTslRuinScorch } from "./terrain-scorch";
import { coverTslSeasonSnow, getTslSeasonWetness, rollOffTslNoonSnow } from "./terrain-season";
import { applyTslAlpineGrass, applyTslGroundVariants } from "./terrain-variants";

/** GLSL applyGroundPalette's quarry greying: real mine ground half desaturated before its tint. */
const greyQuarry = (albedo: TslNode, apron: TslNode) =>
  mix(albedo, vec3(dot(albedo, vec3(0.333))), float(1).sub(apron).mul(GROUND_CONTEXT_TUNING.mineGrey)) as TslNode;
import {
  BLEND_DEPTH,
  createTerrainLighting,
  getCliffShare,
  getGroundContext,
  getShoreWetness,
  getThemeWeights,
  layerTint,
  meadowTint,
  perturbNormal,
  shapeRiverBed,
  shapeSummitSnow,
  shedOntoCliffs,
  SNOW_LAYER,
  SNOW_WIND,
  snowTint,
  type SplatSet,
  SUMMIT_SNOW_CLEAN_TONE_NODE,
  SUMMIT_SNOW_NEUTRAL_NODE,
  turnQuarter
} from "./terrain-nodes";
import {
  bindMatrixColumns,
  bindScalar,
  bindVector,
  createUniformBindings,
  syncUniformBindings
} from "./uniform-bindings";
import { decodeTslWaterDepth } from "./water-depth";
import { createWaterGroundNodes } from "./water-ground";

/**
 * WG-2 first terrain-ground slice: the TSL twin of the ground's base layer path. It samples the
 * same nine albedo/height and normal/AO/roughness texture arrays, blends the splat layers, applies
 * the macro meadow/snow tint and lights with the shared sun/sky/cloud inputs.
 *
 * The cliff beds, summit snow, traffic wear, lawn/shore wetness and the camera air are ported here. Still separate:
 * the animated swash sheet/foam and parallax (tracked in the receipt).
 */
type TslNode = any; // TSL's generated types do not model the proxied node methods;

const TRAFFIC_EARTH = vec3(...TRAFFIC_WEAR_TUNING.earth);

const channel = (node: TslNode, index: number) => {
  if (index === 0) return node.x as TslNode;
  if (index === 1) return node.y as TslNode;
  if (index === 2) return node.z as TslNode;
  return node.w as TslNode;
};

interface MicroDetailInputs {
  albedo: TslNode;
  footprint: TslNode;
  surface: TslNode;
  worldDx: TslNode;
  worldDy: TslNode;
  xz: TslNode;
}

/** GLSL applyMicroDetail (T06a): the dominant layer's micro detail cell in the near band. */
const applyMicroDetail = (microAtlas: Texture, layers: readonly { layer: number; score: TslNode }[],
  { albedo, footprint, surface, worldDx, worldDy, xz }: MicroDetailInputs) => {
  let dominant: TslNode = float(0);
  let bestScore: TslNode = layers[0]!.score;
  for (const sample of layers.slice(1)) {
    dominant = sample.score.greaterThan(bestScore).select(float(sample.layer), dominant) as TslNode;
    bestScore = max(bestScore, sample.score) as TslNode;
  }
  let cell = vec2(0) as TslNode;
  for (const sample of layers) {
    const details = getMicroDetailCell(MICRO_CLASS_OF_MATERIAL[sample.layer]!);
    cell = dominant.equal(float(sample.layer)).select(vec2(details.column, details.row), cell) as TslNode;
  }
  const microUv = cell.add(MICRO_DETAIL_PAD)
    .add(fract(xz.div(MICRO_DETAIL_UNITS)).mul(MICRO_DETAIL_INNER))
    .div(vec2(MICRO_DETAIL_COLUMNS, MICRO_DETAIL_ROWS)) as TslNode;
  const microScale = vec2(
    MICRO_DETAIL_INNER / MICRO_DETAIL_UNITS / MICRO_DETAIL_COLUMNS,
    MICRO_DETAIL_INNER / MICRO_DETAIL_UNITS / MICRO_DETAIL_ROWS
  ) as TslNode;
  const micro = texture(microAtlas, microUv)
    .grad(worldDx.xz.mul(microScale), worldDy.xz.mul(microScale)) as TslNode;
  const near = float(1).sub(smoothstep(0.005, 0.011, footprint)) as TslNode;
  const microNormal = micro.rg.mul(2).sub(1) as TslNode;
  const cavity = float(1).add(micro.a.sub(0.5).mul(0.18).mul(near)) as TslNode;
  return {
    albedo: albedo.mul(mix(1, micro.b.mul(2), near.mul(0.5))) as TslNode,
    surface: vec4(
      surface.x.add(microNormal.x.mul(0.6).mul(near)),
      surface.y.add(microNormal.y.mul(0.6).mul(near)),
      surface.z.mul(cavity),
      surface.w
    ) as TslNode
  };
};

/** The albedo/normal samples and blend are the base ground; no anti-tiling or layer turn yet. */
export const createTslTerrainMaterial = (sourceMaterial: Material): Material | null => {
  const source = (sourceMaterial as { uniforms?: Record<string, IUniform> }).uniforms;
  if (!source?.uGroundAlbedo || !source.uGroundNormal) return null;
  const albedoTexture = source.uGroundAlbedo.value as Texture;
  const normalTexture = source.uGroundNormal.value as Texture;
  const noiseTexture = source.uNoiseTexture?.value as Texture | undefined;
  if (!albedoTexture || !normalTexture || !noiseTexture) return null;

  const bindings = createUniformBindings("terrain", source);
  const world: TslNode = positionWorld;
  const xz = world.xz as TslNode;
  const normalGeometry = normalize(attribute("normal", "vec3") as TslNode) as TslNode;
  const { fbm3, valueNoise, valueNoise4 } = createNoiseNodes(noiseTexture);
  const worldDx = world.dFdx() as TslNode;
  const worldDy = world.dFdy() as TslNode;
  const footprint = max(length(worldDx.xz), length(worldDy.xz)) as TslNode;

  const macro = {
    breakup: valueNoise4(xz.mul(0.5).add(5.1)) as TslNode,
    far: smoothstep(0.018, 0.09, footprint) as TslNode,
    grain: valueNoise4(vec2(
      xz.x.mul(0.8).sub(xz.y.mul(0.6)),
      xz.x.mul(0.6).add(xz.y.mul(0.8))
    ).mul(1.9).add(3.7)) as TslNode,
    patches: valueNoise4(xz.mul(0.085).add(11.3)) as TslNode,
    region: valueNoise4(xz.mul(0.021)) as TslNode
  };

  const canopy = (attribute("shading", "vec4") as TslNode).w as TslNode;
  const snow = snowTint(macro, xz, normalGeometry) as TslNode;
  const summitShare = smoothstep(SUMMIT_SNOW_FLOOR, SUMMIT_SNOW_FLOOR + 1.5, world.y) as TslNode;
  const snowDrift = valueNoise(xz.mul(0.42).add(21.7)) as TslNode;
  const snowRidges = sin(dot(xz, SNOW_WIND).mul(3.4).add(snowDrift.mul(7))).mul(0.5).add(0.5) as TslNode;
  const snowTone = float(1.02).add(snowDrift.sub(0.5).mul(0.06)).sub(snowRidges.mul(0.02)) as TslNode;
  // GLSL tintSummitSnow over snowTint; the summit's clean tone replaces the tile texel (below), not the tint.
  const snowFinal = mix(snow, snow.mul(SUMMIT_SNOW_NEUTRAL_NODE).mul(snowTone), summitShare) as TslNode;
  const explorationFog = bindScalar(bindings, "uExplorationFog") as TslNode;
  const uv = xz.add(macro.patches.xy.sub(0.5).mul(3)) as TslNode;
  const dx = worldDx.xz as TslNode;
  const dy = worldDy.xz as TslNode;
  const untileIndex = macro.patches.w.mul(8) as TslNode;
  const untileFirst = floor(untileIndex) as TslNode;
  const untileBlend = smoothstep(0.65, 0.85, untileIndex.sub(untileFirst)) as TslNode;
  const untileOffset = (index: TslNode) =>
    fract(sin(vec2(3, 7).mul(index)).mul(43758.5453)) as TslNode;
  const untileTurn = (index: TslNode) =>
    floor(fract(sin(index.mul(12.9898).add(4.1)).mul(43758.5453)).mul(4)) as TslNode;
  const offsetA = untileOffset(untileFirst) as TslNode;
  const offsetB = untileOffset(untileFirst.add(1)) as TslNode;
  const turnA = untileTurn(untileFirst) as TslNode;
  const turnB = untileTurn(untileFirst.add(1)) as TslNode;
  const splatA = attribute("splatA", "vec4") as TslNode;
  const splatB = attribute("splatB", "vec4") as TslNode;
  const splatC = attribute("splatC", "vec4") as TslNode;
  const surfaceMask = attribute("surface", "vec4") as TslNode;
  const water = attribute("water", "vec4") as TslNode;
  const cliff = getCliffShare(normalGeometry) as TslNode;
  const shed = shedOntoCliffs(splatA, splatB, splatC, normalGeometry);
  // GROUND-PALETTE: island sand/soil/rock palette and climate by theme weights, sunny-slope dryness, grey apron.
  const context = getGroundContext(attribute("theme", "vec4") as TslNode, surfaceMask, shed.apron, water.x, {
    climate: bindMatrixColumns(bindings, "uClimatePalette"), rock: bindMatrixColumns(bindings, "uRockPalette"),
    sand: bindMatrixColumns(bindings, "uSandPalette"), soil: bindMatrixColumns(bindings, "uSoilPalette")
  });
  const meadow = meadowTint(macro, canopy, bindScalar(bindings, "uRain"), context.dry,
    bindVector(bindings, "uSeasonMeadow", 4)) as TslNode;
  const summit = shapeSummitSnow(shed, world, normalGeometry, (attribute("shading", "vec4") as TslNode).y,
    valueNoise) as SplatSet;
  const river = shapeRiverBed(summit.a, summit.b, water, xz, valueNoise);
  // T1: the global season's GPU snow (compiled only while the season can snow, like the GLSL SEASON_SNOW).
  const seasonSnow = (sourceMaterial as { defines?: Record<string, unknown> }).defines?.SEASON_SNOW !== undefined
    ? coverTslSeasonSnow({ a: river.a, apron: shed.apron, b: river.b, c: summit.c }, xz, water.x, normalGeometry,
      bindVector(bindings, "uSeasonCover", 4), source.uSnowMap?.value as Texture | undefined, valueNoise)
    : { ...river, c: summit.c };
  const splats = [seasonSnow.a, seasonSnow.b, seasonSnow.c];

  let rockTexelAlpha: TslNode | null = null;
  const layers = MATERIAL_TILE_UNITS.map((units: number, layer: number) => {
    const scale = 1 / units;
    const allowTurn = layer === MATERIAL.sand || layer === MATERIAL.snow ||
      layer === MATERIAL.mine ? 0 : 1;
    const turnsA = turnA.mul(allowTurn) as TslNode;
    const turnsB = turnB.mul(allowTurn) as TslNode;
    const scaledUv = uv.mul(scale) as TslNode;
    const scaledDx = dx.mul(scale) as TslNode;
    const scaledDy = dy.mul(scale) as TslNode;
    const albedoA = arraySample(albedoTexture,
      turnQuarter(scaledUv, turnsA).add(offsetA),
      turnQuarter(scaledDx, turnsA), turnQuarter(scaledDy, turnsA), layer);
    const albedoB = arraySample(albedoTexture,
      turnQuarter(scaledUv, turnsB).add(offsetB),
      turnQuarter(scaledDx, turnsB), turnQuarter(scaledDy, turnsB), layer);
    const albedo = mix(albedoA, albedoB, untileBlend) as TslNode;
    const normalTurn = untileBlend.lessThan(0.5).select(turnsA, turnsB) as TslNode;
    const normalOffset = untileBlend.lessThan(0.5).select(offsetA, offsetB) as TslNode;
    const normalRaw = arraySample(normalTexture,
      turnQuarter(scaledUv, normalTurn).add(normalOffset),
      turnQuarter(scaledDx, normalTurn), turnQuarter(scaledDy, normalTurn), layer);
    const normalDecoded = turnQuarter(normalRaw.rg.mul(2).sub(1),
      float(4).sub(normalTurn).mod(4)) as TslNode;
    const normal = vec4(normalDecoded.x, normalDecoded.y, normalRaw.b, normalRaw.a) as TslNode;
    const noise = channel(macro.breakup, layer & 3).mul(0.55)
      .add(channel(macro.grain, (layer + 1) & 3).mul(0.45)) as TslNode;
    const breakup = layer < 4 ? noise : float(1).sub(noise);
    // GLSL sampleRockTriplanar: the rock layer's texel is the wall projection (its relief too).
    const wall = layer === MATERIAL.rock
      ? sampleWallRock({ albedo, albedoTexture, cliff, normal: normalGeometry, normalTexture, scale,
        valueNoise, world, worldDx, worldDy })
      : null;
    if (wall !== null) rockTexelAlpha = wall.alpha;
    let relief = (wall?.alpha ?? albedo.a).mul(0.55).add(breakup.sub(0.5).mul(0.8)) as TslNode;
    // SNOW-LAYER height edge: summit snow fills the rock's hollows first, the rock's ridges poke through.
    if (layer === SNOW_LAYER && rockTexelAlpha !== null) {
      const edge = float(1).sub(rockTexelAlpha).mul(0.75).add(breakup.sub(0.5).mul(0.4)) as TslNode;
      relief = mix(relief, edge, summitShare.mul(step(0.004, splats[1]!.y))) as TslNode;
    }
    let splat = splats[2]!;
    if (layer < 8) splat = splats[1]!;
    if (layer < 4) splat = splats[0]!;
    const weight = channel(splat, layer % 4) as TslNode;
    const score = weight.add(relief.mul(min(1, weight.mul(3)))) as TslNode;
    return { albedo, cliffAlbedo: wall?.albedo ?? vec3(0), layer, normal, score, wallNormal: wall?.normal ?? vec3(0) };
  });

  const best = layers.reduce((value: TslNode, layer: { score: TslNode }) => max(value, layer.score), layers[0]!.score) as TslNode;
  // Extra blend depth where summit snow meets rock: a soft, grainy edge instead of a cut line.
  const blendDepth = float(BLEND_DEPTH).add(float(SUMMIT_SNOW_BLEND_DEPTH).mul(summitShare)
    .mul(step(0.004, splats[1]!.z))) as TslNode;
  let snowContribution: TslNode = float(0);
  let total: TslNode = float(0);
  let albedoSum: TslNode = vec3(0);
  let normalSum: TslNode = vec4(0);
  let wallNormalSum: TslNode = vec3(0);
  for (const sample of layers) {
    const contribution = max(sample.score.sub(best.sub(blendDepth)), 0) as TslNode;
    const tint = layerTint(sample.layer, meadow, canopy, context) as TslNode;
    let layerAlbedo = sample.albedo.rgb.mul(tint) as TslNode;
    if (sample.layer === MATERIAL.sand) layerAlbedo = min(layerAlbedo, vec3(1)) as TslNode;
    if (sample.layer === MATERIAL.mine)
      layerAlbedo = greyQuarry(sample.albedo.rgb, context.apron).mul(tint) as TslNode;
    if (sample.layer === SNOW_LAYER) {
      layerAlbedo = mix(sample.albedo.rgb, SUMMIT_SNOW_CLEAN_TONE_NODE, summitShare.mul(SUMMIT_SNOW_CLEAN))
        .mul(snowFinal) as TslNode;
    }
    if (sample.layer === MATERIAL.rock) layerAlbedo = min(sample.cliffAlbedo.mul(context.rock), vec3(1)) as TslNode;
    const decodedNormal = sample.normal.rg.mul(2).sub(1) as TslNode;
    albedoSum = albedoSum.add(layerAlbedo.mul(contribution)) as TslNode;
    normalSum = normalSum.add(
      vec4(decodedNormal.x, decodedNormal.y, sample.normal.b, sample.normal.a).mul(contribution)
    ) as TslNode;
    if (sample.layer === MATERIAL.rock)
      wallNormalSum = wallNormalSum.add(sample.wallNormal.mul(contribution)) as TslNode;
    if (sample.layer === SNOW_LAYER) snowContribution = contribution;
    total = total.add(contribution) as TslNode;
  }
  const safeTotal = max(total, 0.000001) as TslNode;
  const summitSnowLayer = summitShare.mul(snowContribution).div(safeTotal) as TslNode;
  let albedo = albedoSum.div(safeTotal) as TslNode;
  let surface = normalSum.div(safeTotal) as TslNode;

  // T06a micro detail near the dominant layer (one atlas fetch in the near band).
  const microAtlas = source.uMicroAtlas?.value as Texture | undefined;
  if (microAtlas) ({ albedo, surface } = applyMicroDetail(microAtlas, layers, { albedo, footprint, surface, worldDx,
    worldDy, xz }));
  ({ albedo, surface } = applySummitSnowLayer(albedo, surface, summitSnowLayer));
  albedo = albedo.mul(mix(mix(0.9, 1.08, macro.region.w), 1, summitSnowLayer)) as TslNode;

  // GLSL `bumpStrength`: the top-down layer normals fade with distance and are suppressed on
  // rock walls, where the gravel's planar normals carry the relief (never mix them away).
  const rockWeight = splats[1]!.y as TslNode;
  const walls = cliff.greaterThan(0.02).and(rockWeight.greaterThan(0.004)) as TslNode;
  const bumpStrength = mix(0.95, 0.6, macro.far)
    .mul(float(1).sub(cliff.mul(walls.select(1, 0.6)))) as TslNode;
  const normal = perturbNormal(normalGeometry, surface, bumpStrength) as TslNode;
  const worldSize = bindVector(bindings, "uWorldSize", 2) as TslNode;
  const safeWorldSize = max(worldSize, vec2(1)) as TslNode;
  const coverField = source.uCoverField?.value as Texture | undefined;
  const lawnDepth = source.uLawnDepth ? bindVector(bindings, "uLawnDepth", 4) as TslNode : vec4(1);
  if (coverField) {
    const cover = texture(coverField, xz.div(safeWorldSize)).r
      .mul(clamp(splats[0]!.x.add(splats[0]!.y).add(splats[0]!.z), 0, 1)) as TslNode;
    const lawn = cover.mul(float(1).sub(smoothstep(0.99, 1, lawnDepth.w))) as TslNode;
    albedo = albedo.mul(mix(vec3(1), lawnDepth.rgb, lawn)) as TslNode;
    surface = vec4(surface.x, surface.y, surface.z.mul(mix(1, lawnDepth.w, lawn)), surface.w) as TslNode;
  }
  const trafficTexture = source.uTrafficWear?.value as Texture | undefined;
  if (trafficTexture) {
    const traffic = texture(trafficTexture, xz.div(safeWorldSize)).r as TslNode;
    const trafficFill = smoothstep(0.62, 1, traffic) as TslNode;
    const trafficWear = trafficFill.mul(0.6) as TslNode;
    const brightness = clamp(dot(albedo, vec3(0.2126, 0.7152, 0.0722)).div(0.16),
      0.7, 1.35) as TslNode;
    const [packedFrom, packedTo] = TRAFFIC_WEAR_TUNING.packedRange;
    const packed = smoothstep(packedFrom, packedTo, trafficWear.mul(0.82)) as TslNode;
    const earth = mix(TRAFFIC_EARTH.mul(brightness), vec3(...TRAFFIC_WEAR_TUNING.packedEarth), packed) as TslNode;
    albedo = mix(albedo, earth, trafficWear.mul(0.82)) as TslNode;
  }
  const normalWithWall = normalize(normal.add(
    wallNormalSum.mul(cliff).div(safeTotal))) as TslNode;
  const waterField = source.uWaterField?.value as Texture | undefined;
  const field = waterField
    ? texture(waterField, xz.div(safeWorldSize)) as TslNode
    : vec4(0, 0.5, 1, 0) as TslNode;
  const signedDepth = decodeTslWaterDepth(field.x) as TslNode;
  // GROUND-PALETTE step 2: the render-only variant tiles over the blended albedo.
  const litter = attribute("litter", "vec4") as TslNode;
  const themeWeights = getThemeWeights(attribute("theme", "vec4") as TslNode);
  const height = signedDepth.negate() as TslNode;
  albedo = applyTslAlpineGrass(albedo, splats, world, litter.z);
  // Step 5 climate detail (ground-climate-glsl.ts): heather, dune grass, tidal silt flats, basalt, wrack line.
  albedo = applyTslHeather(albedo, clamp(splats[0]!.x.add(splats[0]!.y), 0, 1), context.heather, surfaceMask.w,
    world) as TslNode;
  albedo = applyTslDuneGrass(albedo, litter.w, splats[1]!.x, height, xz) as TslNode;
  // Crop plots' cultivated soil (cover field G): tilled soil under the crops.
  const fieldSoil = (coverField ? texture(coverField, xz.div(safeWorldSize)).g : float(0)) as TslNode;
  const tidal = getTslTidalFlat(surfaceMask.y, splats[1]!.x, height, normalGeometry, xz, themeWeights.w) as TslNode;
  const basaltRock = clamp(splats[1]!.y.add(splats[2]!.x), 0, 1) as TslNode;
  const basalt = basaltRock.mul(context.lava).mul(smoothstep(GROUND_VARIANT_TUNING.basaltNormal[0],
    GROUND_VARIANT_TUNING.basaltNormal[1], normalGeometry.y)) as TslNode;
  const seasonCover = bindVector(bindings, "uSeasonCover", 4) as TslNode;
  albedo = applyTslGroundVariants(albedo, albedoTexture, xz, {
    basalt, canopy, context, fieldRows: fieldSoil, litter, normal: normalGeometry,
    paint: attribute("variant", "vec4") as TslNode, seasonCover, seasonLitter: bindVector(bindings, "uSeasonLitter", 4),
    signedDepth, splats, surface: surfaceMask, themeWeights,
    tilled: max((attribute("theme", "vec4") as TslNode).w, fieldSoil), world
  }) as TslNode;
  albedo = applyTslTidalSilt(albedo, tidal, xz) as TslNode;
  // Step 7: the tropical jungle floor and the scorched ground around fresh ruins.
  albedo = applyTslJungleFloor(albedo, splats[0]!.z, context.jungle) as TslNode;
  albedo = applyTslRuinScorch(albedo, xz, bindings) as TslNode;
  const coast = field.y.sub(0.5).mul(16) as TslNode;
  const snowShare = clamp(splats[1]!.z, 0, 1) as TslNode;
  albedo = applyTslWrackLine(albedo, height, surfaceMask.y, splats[1]!.x, xz, float(1).sub(snowShare)) as TslNode;
  const bankWetness = getTslSeasonWetness(max(surfaceMask.x, tidal.mul(GROUND_CLIMATE_TUNING.tidalWetness)),
    themeWeights.y, seasonCover).mul(float(1).sub(snowShare)) as TslNode;
  const shoreWetness = getShoreWetness(signedDepth, coast, xz) as TslNode;
  // GLSL wetShoreGround: snow keeps only the saturated darkening (min with mix(0.5, 1, open)).
  const wetness = min(max(shoreWetness, bankWetness.mul(0.85)), mix(0.5, 1, float(1).sub(snowShare))) as TslNode;
  const porcelain = float(1)
    .sub(splats[0]!.x.add(splats[0]!.y).mul(0.5))
    .sub(splats[1]!.y.mul(0.55))
    .sub(splats[1]!.w.mul(0.3)) as TslNode;
  // Submerged ground is fully porous (GLSL mix(1, getGroundPorosity, exposed)).
  const porosity = mix(1, clamp(porcelain, 0, 1), smoothstep(-0.03, 0, height)) as TslNode;
  const soak = min(wetness.mul(2), 1).mul(porosity) as TslNode;
  const film = smoothstep(0.5, 1, wetness) as TslNode;
  const wetDarken = mix(GROUND_CONTEXT_TUNING.wetDarken, context.sandWet, clamp(splats[1]!.x, 0, 1)) as TslNode;
  const wetAlbedo = albedo.mul(mix(1, wetDarken, soak)) as TslNode;
  const wetRoughness = mix(surface.w, 0.14, film) as TslNode;
  // GLSL applyGroundWetness: mix(normal, geometryNormal, film * WET_FILM_FLATTEN). The chained
  // `a.mix(b, t)` is TSL's mixElement (mix(b, t, a)) and bent every normal toward the horizon.
  const flatten = film.mul(0.65) as TslNode;
  const wetNormal = normalize(normalWithWall.add(normalGeometry.sub(normalWithWall).mul(flatten))) as TslNode;

  const sun = bindVector(bindings, "uSunDirection", 3) as TslNode;
  const sunColor = bindVector(bindings, "uSunColor", 3) as TslNode;
  const rain = bindScalar(bindings, "uRain") as TslNode;
  const bakedWeight = bindScalar(bindings, "uBakedShadowWeight") as TslNode;
  const fogColor = bindVector(bindings, "uFogColor", 3) as TslNode;
  const time = bindScalar(bindings, "uTime") as TslNode;
  const fogOfWarLit = bindScalar(bindings, "uFogOfWarLit") as TslNode;
  const shading = attribute("shading", "vec4") as TslNode;
  const visibility = mix(1, shading.x, bakedWeight).mul(sunShadowAt(source, world)) as TslNode;
  // GLSL getCliffOcclusion(vShading.y, normal): the baked vertex occlusion, not the tile AO
  // (surface.z multiplies in below as ground.occlusion; using it twice darkened every crevice).
  const occlusion = mix(shading.y, 1, cliff.mul(0.6)) as TslNode;
  const lighting = createTerrainLighting(bindings, sourceMaterial, fbm3, { rain, sun, sunColor });
  // `lightGround` (ground-common-glsl): the island lights the display-authored tiles in display
  // space; the shared colour tail decodes, tone maps and grades like `finishColor`.
  const cavity = mix(float(1), surface.z, 0.5) as TslNode;
  const litBase = lighting.lightSurface(wetAlbedo.mul(cavity), wetNormal, visibility,
    occlusion.mul(surface.z), xz) as TslNode;
  const viewDirection = bindVector(bindings, "uViewDirection", 3) as TslNode;
  const halfway = normalize(sun.add(viewDirection)) as TslNode;
  const gloss = float(1).sub(wetRoughness.mul(float(1).sub(rain.mul(0.45)))) as TslNode;
  const power = float(4).add(gloss.mul(gloss).mul(80)) as TslNode;
  const highlight = max(dot(wetNormal, halfway), 0).pow(power).mul(power.add(2)).mul(0.005) as TslNode;
  const noonSnow = snowContribution.div(safeTotal).mul(float(1).sub(summitShare))
    .mul(float(1).sub(explorationFog)) as TslNode;
  const lit = rollOffTslNoonSnow(litBase.add(sunColor.mul(highlight).mul(gloss).mul(visibility).mul(surface.z)),
    noonSnow, sun.y) as TslNode;
  const waterGround = createWaterGroundNodes({
    cloudShadow: lighting.cloudShadow,
    sunColor,
    sunDirection: sun,
    sunVisibility: visibility,
    time,
    valueNoise
  });
  const litWithCaustics = waterGround.waterlineGround(lit, signedDepth, xz) as TslNode;

  const fog = createFogNodes({ fbm3, liveFog: createLiveFogSampler(bindings), noiseTexture });
  const visibilityField = field.z as TslNode;
  const view = normalize(cameraPosition.sub(world)) as TslNode;
  const color = fog.applyFogOfWar(litWithCaustics, visibilityField, xz, worldSize, time, explorationFog,
    fogOfWarLit, fogColor, rain, view, sun, sunColor) as TslNode;
  const finish = createSurfaceColorTail(bindings);
  const air = createSurfaceAir(bindings);
  const material = new MeshBasicNodeMaterial({
    alphaTest: (sourceMaterial as { alphaTest?: number }).alphaTest,
    depthTest: sourceMaterial.depthTest,
    depthWrite: sourceMaterial.depthWrite,
    opacity: sourceMaterial.opacity,
    side: sourceMaterial.side,
    transparent: sourceMaterial.transparent
  });
  material.name = "wg2:terrain";
  // Camera air: submerged ground is seen through the water surface, which applies it once.
  material.colorNode = Fn(() => {
    // GLSL gates on the decoded depth (sampleWaterField); field.x is the encoded byte.
    // P33: the colour tree first builds this shared depth inside an If arm; pin it at the Fn top
    // so the air gate below reads the same variable.
    const depth = signedDepth.toVar();
    const tau = depth.lessThanEqual(0).select(air.surfaceTau(world), float(0));
    return finish(color, air.forward(tau));
  })();
  material.toneMapped = false;
  material.userData.wg2Ported = true;
  material.userData.wg2TerrainSlice = "base";
  material.userData.syncUniforms = () => syncUniformBindings(bindings);
  return material;
};
