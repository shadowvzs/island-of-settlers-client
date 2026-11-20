import { abs, clamp, cross, dot, float, length, max, mix, normalize, sin, smoothstep, vec2, vec3, vec4 } from "three/tsl";
import type { Material } from "three/webgpu";

import {
  CLIFF_NORMAL,
  CLIFF_OCHRE_TINT,
  CLIFF_ROCK_SHARE,
  CLIFF_SATURATION,
  CLIFF_STONE_TONE,
  CLIFF_TINT,
  SNOW_HOLD_NORMAL,
  SUMMIT_SNOW_CLEAN_TONE,
  SUMMIT_SNOW_FADE,
  SUMMIT_SNOW_FLOOR,
  SUMMIT_SNOW_HOLD,
  SUMMIT_SNOW_HOLLOW_RUN,
  SUMMIT_SNOW_LEE,
  SUMMIT_SNOW_LINE,
  SUMMIT_SNOW_NEUTRAL,
  SUMMIT_SNOW_WANDER,
  SUMMIT_SNOW_WIND
} from "../../../render-common/shaders/ground-cliff-glsl";
import { MEADOW_TINT, RAIN_LUSH_TINT } from "../../../render-common/shaders/ground-common-glsl";
import { GROUND_BLEND_DEPTH } from "../../../render-common/shaders/ground-glsl";
import { GROUND_CONTEXT_TUNING } from "../../../render-common/shaders/ground-palette-glsl";
import { SHORE_WETNESS_TUNING } from "../../../render-common/shaders/shore-wetness-glsl";
import { SNOW_PALETTE } from "../../../render-common/snow-palette";
import { MATERIAL } from "../../../shared/world/world-data";
import { createLightingNodes } from "./lighting";
import { bindScalar, bindVector, bindVector3Array, type UniformBindings } from "./uniform-bindings";

type TslNode = any; // TSL's generated types do not model the proxied node methods;

export const SNOW_LAYER = MATERIAL.snow;
export const FOREST_LAYER = MATERIAL.forestFloor;
export const BLEND_DEPTH = GROUND_BLEND_DEPTH;
const SNOW_SHADE = vec3(...SNOW_PALETTE.groundShade);
export const SNOW_WIND = vec2(SUMMIT_SNOW_WIND[0], SUMMIT_SNOW_WIND[1]);
export const SUMMIT_SNOW_CLEAN_TONE_NODE = vec3(...SUMMIT_SNOW_CLEAN_TONE);
export const SUMMIT_SNOW_NEUTRAL_NODE = vec3(...SUMMIT_SNOW_NEUTRAL);

interface TerrainLightInputs { rain: TslNode; sun: TslNode; sunColor: TslNode; }

/** The shared LIGHTING_GLSL twin bound to the ground's SH9 sky, cloud and highlight uniforms. */
export const createTerrainLighting = (bindings: UniformBindings, sourceMaterial: Material,
  fbm3: (point: TslNode) => TslNode, { rain, sun, sunColor }: TerrainLightInputs) => {
  const fragmentShader = (sourceMaterial as { fragmentShader?: string }).fragmentShader ?? "";
  return createLightingNodes({
    ambientSky: bindVector(bindings, "uAmbientSky", 3),
    cloudCover: bindScalar(bindings, "uCloudCover"),
    cloudDrift: bindVector(bindings, "uCloudDrift", 2),
    fbm3,
    highlight: bindScalar(bindings, "uHighlight"),
    lowOrderSky: fragmentShader.includes("#define SKY_IRRADIANCE_L1"),
    rain,
    skyIrradiance: bindVector3Array(bindings, "uSkyIrradiance", 9),
    sunColor,
    sunDirection: sun,
    viewDirection: bindVector(bindings, "uViewDirection", 3)
  });
};

export interface SplatSet { a: TslNode; b: TslNode; c: TslNode; }

/** The GroundContext of ground-palette-glsl.ts: palette tints, theme-scaled dryness, apron share, climate shares. */
export interface GroundContextNodes {
  apron: TslNode; dry: TslNode; heather: TslNode; jungle: TslNode; lava: TslNode; rock: TslNode; sand: TslNode;
  sandWet: TslNode; soil: TslNode; swamp: TslNode;
}

/** The four theme columns of each palette matrix (sand, soil, rock, climate). */
export interface PaletteColumns { climate: TslNode[]; rock: TslNode[]; sand: TslNode[]; soil: TslNode[]; }

/** `getThemeWeights`: xyz from the attribute, the snowy weight the rest (w carries the tilled paint), sum 1. */
export const getThemeWeights = (theme: TslNode) => {
  const weights = vec4(theme.xyz, max(float(1).sub(dot(theme.xyz, vec3(1))), 0)) as TslNode;
  return weights.div(max(dot(weights, vec4(1)), 1e-3)) as TslNode;
};

/** `getGroundContext`: the vertex theme weights mix the palette matrix columns (one per theme). */
export const getGroundContext = (theme: TslNode, surface: TslNode, apron: TslNode, waterDepth: TslNode,
  columns: PaletteColumns): GroundContextNodes => {
  const weights = getThemeWeights(theme);
  const mixColumns = (columns: TslNode[]) => columns[0].mul(weights.x).add(columns[1].mul(weights.y))
    .add(columns[2].mul(weights.z)).add(columns[3].mul(weights.w)) as TslNode;
  const sand = mixColumns(columns.sand);
  const [fadeFrom, fadeTo, fadeShare] = GROUND_CONTEXT_TUNING.seabedFade;
  const sandRgb = mix(sand.xyz, vec3(1), smoothstep(fadeFrom, fadeTo, waterDepth).mul(fadeShare)) as TslNode;
  const dry = surface.w.mul(dot(weights, vec4(...GROUND_CONTEXT_TUNING.dryThemeStrength))) as TslNode;
  const soil = mixColumns(columns.soil);
  const rock = mixColumns(columns.rock);
  const climate = mixColumns(columns.climate);
  return { apron, dry, heather: climate.x, jungle: climate.y, lava: rock.w, rock: rock.xyz, sand: sandRgb,
    sandWet: sand.w, soil: soil.xyz, swamp: soil.w };
};

export const getCliffBeds = (world: TslNode, noise: (point: TslNode) => TslNode) => {
  const tone = noise(world.xz.mul(0.045).add(world.y.mul(0.03)).add(5.3)) as TslNode;
  const ochre = smoothstep(0.55, 0.85,
    noise(world.xz.mul(0.03).sub(world.y.mul(0.02)).add(8.8))) as TslNode;
  return { ochre, tone } as const;
};

export const applyCliffBeds = (albedo: TslNode, gravel: TslNode, beds: { ochre: TslNode; tone: TslNode },
  share: TslNode) => {
  const grain = mix(gravel, albedo, CLIFF_ROCK_SHARE) as TslNode;
  const grey = dot(grain, vec3(0.333)) as TslNode;
  const stone = mix(grey, grain, CLIFF_SATURATION) as TslNode;
  const tint = mix(vec3(...CLIFF_TINT), vec3(...CLIFF_OCHRE_TINT), beds.ochre.mul(0.5))
    .mul(mix(0.94, 1.1, beds.tone)) as TslNode;
  return mix(albedo, stone.mul(tint).mul(vec3(...CLIFF_STONE_TONE)), share) as TslNode;
};

export const getCliffShare = (normal: TslNode) =>
  float(1).sub(smoothstep(CLIFF_NORMAL[0], CLIFF_NORMAL[1], normal.y)) as TslNode;

export const getSnowHold = (normal: TslNode) =>
  smoothstep(SNOW_HOLD_NORMAL[0], SNOW_HOLD_NORMAL[1], normal.y) as TslNode;

/**
 * MC-08 splat shedding: steep faces become bare rock, loose cover and snow slide off; `apron` is the
 * share of the mine layer that is shed rock (grey apron, GLSL shedOntoCliffs' return value).
 */
export const shedOntoCliffs = (a: TslNode, b: TslNode, c: TslNode, normal: TslNode):
  SplatSet & { apron: TslNode } => {
  const cliff = getCliffShare(normal) as TslNode;
  const keepSnow = getSnowHold(normal).mul(float(1).sub(cliff)) as TslNode;
  const rock = b.y as TslNode;
  const moved = a.x.add(a.y).add(a.z).add(a.w).mul(cliff)
    .add(b.x.add(b.w).mul(cliff))
    .add(b.z.mul(float(1).sub(keepSnow))) as TslNode;
  const aOut = a.mul(float(1).sub(cliff)) as TslNode;
  const bOut = vec4(
    b.x.mul(float(1).sub(cliff)),
    rock.mul(cliff).add(moved),
    b.z.mul(keepSnow),
    b.w.mul(float(1).sub(cliff))
  ) as TslNode;
  const apron = rock.mul(float(1).sub(cliff)) as TslNode;
  const cOut = vec4(c.x.add(apron), c.y, c.z, c.w) as TslNode;
  return { a: aOut, apron: clamp(apron.div(max(cOut.x, 1e-4)), 0, 1), b: bOut, c: cOut };
};

export const getSummitSnow = (world: TslNode, normal: TslNode, occlusion: TslNode,
  noise: (point: TslNode) => TslNode) => {
  const broad = noise(world.xz.mul(0.07).add(2.3)) as TslNode;
  const hollow = clamp(float(0.92).sub(occlusion).mul(2.5), 0, 1) as TslNode;
  const lee = dot(normalize(normal.xz.add(vec2(1e-4))), SNOW_WIND).mul(float(1).sub(normal.y)) as TslNode;
  const line = float(SUMMIT_SNOW_LINE).add(broad.sub(0.5).mul(SUMMIT_SNOW_WANDER)).sub(hollow.mul(SUMMIT_SNOW_HOLLOW_RUN)).sub(lee.mul(SUMMIT_SNOW_LEE)) as TslNode;
  const altitude = smoothstep(line, line.add(SUMMIT_SNOW_FADE), world.y) as TslNode;
  const hold = smoothstep(SUMMIT_SNOW_HOLD[0], SUMMIT_SNOW_HOLD[1], normal.y.add(hollow.mul(0.45))) as TslNode;
  const cover = altitude.mul(hold) as TslNode;
  const breakup = noise(world.xz.mul(0.16).add(world.y.mul(0.05)).add(9.1)).mul(0.55)
    .add(noise(world.xz.mul(0.45).add(4.7)).mul(0.45)) as TslNode;
  return smoothstep(0.33, 0.6, cover.mul(0.85).add(breakup.mul(0.75)))
    .mul(smoothstep(0.12, 0.3, cover)) as TslNode;
};

export const shapeSummitSnow = (splats: SplatSet, world: TslNode, normal: TslNode, occlusion: TslNode,
  noise: (point: TslNode) => TslNode): SplatSet => {
  const band = smoothstep(SUMMIT_SNOW_FLOOR, SUMMIT_SNOW_FLOOR + 1, world.y) as TslNode;
  const splatSnow = splats.b.z as TslNode;
  const summit = max(getSummitSnow(world, normal, occlusion, noise),
    splatSnow.mul(float(1).sub(band))) as TslNode;
  const snow = mix(splatSnow, summit, band) as TslNode;
  const keep = float(1).sub(snow).div(max(float(1).sub(splatSnow), 1e-4)) as TslNode;
  const less = snow.lessThan(splatSnow) as TslNode;
  const lessA = splats.a as TslNode;
  const lessB = vec4(splats.b.x, splats.b.y.add(splatSnow.sub(snow)), snow, splats.b.w) as TslNode;
  const gainA = splats.a.mul(keep) as TslNode;
  const gainB = vec4(splats.b.x.mul(keep), splats.b.y.mul(keep), snow, splats.b.w.mul(keep)) as TslNode;
  const lessC = splats.c as TslNode;
  const gainC = vec4(splats.c.x.mul(keep), splats.c.y, splats.c.z, splats.c.w) as TslNode;
  return {
    a: less.select(lessA, gainA) as TslNode,
    b: less.select(lessB, gainB) as TslNode,
    c: less.select(lessC, gainC) as TslNode
  };
};

export const getShoreBreakup = (xz: TslNode) => {
  const wobble = sin(dot(xz, vec2(1.7, -1.1))).mul(0.5)
    .add(sin(dot(xz, vec2(-0.6, 2.3)).add(1.3)).mul(0.5)) as TslNode;
  const patches = sin(dot(xz, vec2(2.9, 1.9))
    .add(sin(dot(xz, vec2(-1.3, 3.7))).mul(1.6))).mul(0.5).add(0.5) as TslNode;
  return { patches, wobble } as const;
};

/** TT-1 shore bands without the animated swash sheet and foam. */
export const getShoreWetness = (signedDepth: TslNode, coast: TslNode, xz: TslNode) => {
  const height = signedDepth.negate() as TslNode;
  const exposed = smoothstep(-0.03, 0, height) as TslNode;
  const breakup = getShoreBreakup(xz) as { patches: TslNode; wobble: TslNode };
  const jitter = breakup.wobble.mul(0.5) as TslNode;
  const { damp: dampWetness, dampCoast, dampCurve, dampHeight, soak, soakHeight } = SHORE_WETNESS_TUNING;
  const soaked = float(soak).mul(float(1).sub(smoothstep(soakHeight[0], soakHeight[1],
    height.add(jitter.mul(0.05))))) as TslNode;
  const dampTop = float(dampHeight[1]).mul(float(1).add(breakup.wobble.mul(0.2))) as TslNode;
  const damp = float(dampWetness)
    .mul(float(1).sub(smoothstep(dampHeight[0], dampTop, height)).pow(dampCurve))
    .mul(float(1).sub(smoothstep(dampCoast[0], dampCoast[1], coast.add(jitter.mul(0.6))))) as TslNode;
  const bands = float(0.5).mul(float(1).sub(exposed)).add(exposed.mul(max(soaked, damp))) as TslNode;
  const inBand = float(1).sub(smoothstep(0.744, 0.82, height))
    .mul(float(1).sub(smoothstep(2.6, 3.0, coast))) as TslNode;
  return bands.mul(inBand) as TslNode;
};

export const turnQuarter = (value: TslNode, turns: TslNode) => {
  const one = vec2(value.y.negate(), value.x) as TslNode;
  const two = value.negate() as TslNode;
  const three = vec2(value.y, value.x.negate()) as TslNode;
  const pick = (node: TslNode, turn: number) => turns.equal(turn).select(node, vec2(0)) as TslNode;
  return pick(value, 0).add(pick(one, 1)).add(pick(two, 2)).add(pick(three, 3)) as TslNode;
};

/** GLSL `layerTint` (the sand's palette is applied with its white clamp in terrain.ts). */
export const layerTint = (layer: number, meadow: TslNode, canopy: TslNode, context: GroundContextNodes) => {
  if (layer === MATERIAL.grass) return meadow;
  if (layer === MATERIAL.lushGrass) return meadow.mul(vec3(...GROUND_CONTEXT_TUNING.cloverTint));
  if (layer === FOREST_LAYER) return mix(1, 0.82, canopy);
  if (layer === MATERIAL.dirt) return context.soil;
  if (layer === MATERIAL.sand) return context.sand;
  if (layer === MATERIAL.mine) {
    return mix(vec3(...GROUND_CONTEXT_TUNING.mineTint), vec3(...GROUND_CONTEXT_TUNING.apronTint), context.apron)
      .mul(context.rock);
  }
  return vec3(1);
};

export const shapeRiverBed = (splatA: TslNode, splatB: TslNode, water: TslNode, xz: TslNode,
  noise: (point: TslNode) => TslNode) => {
  const depth = water.x as TslNode;
  const speed = length(water.zw) as TslNode;
  const wander = noise(xz.mul(1.1).add(23.7)).mul(2).sub(1) as TslNode;
  const scoured = speed.add(wander.mul(0.45)) as TslNode;
  const submerged = smoothstep(0.03, 0.14, depth.add(wander.mul(0.055))) as TslNode;
  const coarse = smoothstep(0.75, 1.25, scoured).mul(submerged) as TslNode;
  const boulder = smoothstep(1.55, 2.05, scoured) as TslNode;
  const sand = splatB.x as TslNode;
  const dirt = splatA.w as TslNode;
  const gravel = splatB.w as TslNode;
  const rock = splatB.y as TslNode;
  const fines = sand.add(dirt).mul(coarse) as TslNode;
  const keep = float(1).sub(coarse) as TslNode;
  return {
    a: vec4(splatA.x, splatA.y, splatA.z, dirt.mul(keep)) as TslNode,
    b: vec4(sand.mul(keep), rock.add(fines.mul(boulder)),
      splatB.z, gravel.add(fines.mul(float(1).sub(boulder)))) as TslNode
  };
};

/** `groundTangentBasis` of ground-common-glsl: the layer normals in the ground tangent frame. */
export const perturbNormal = (geometryNormal: TslNode, surface: TslNode,
  strength: TslNode | number = 0.95) => {
  const xAxis = vec3(1, 0, 0).sub(geometryNormal.mul(geometryNormal.x)) as TslNode;
  const zAxis = vec3(0, 0, 1).sub(geometryNormal.mul(geometryNormal.z)) as TslNode;
  const tangent = abs(geometryNormal.x).lessThan(0.999)
    .select(normalize(xAxis), normalize(zAxis)) as TslNode;
  const bitangent = normalize(cross(tangent, geometryNormal)) as TslNode;
  return normalize(geometryNormal
    .add(tangent.mul(surface.x.mul(strength)))
    .add(bitangent.mul(surface.y.mul(strength)))) as TslNode;
};

export const meadowTint = (macro: {
  breakup: TslNode; far: TslNode; grain: TslNode; patches: TslNode; region: TslNode;
}, canopy: TslNode, rain: TslNode, dry: TslNode, season: TslNode) => {
  const tuning = GROUND_CONTEXT_TUNING;
  const yellowGreen = smoothstep(0.36, 0.7, macro.region.x) as TslNode;
  const patchDry = smoothstep(0.58, 0.78, macro.patches.z)
    .mul(smoothstep(0.42, 0.62, macro.region.z)) as TslNode;
  const broken = dry.add(macro.patches.z.sub(0.5).mul(tuning.dryBreakup[0]))
    .add(macro.breakup.y.sub(0.5).mul(tuning.dryBreakup[1])) as TslNode;
  const sunny = smoothstep(tuning.dryRange[0], tuning.dryRange[1], broken) as TslNode;
  let tint = mix(vec3(...MEADOW_TINT.blueGreen), vec3(...MEADOW_TINT.yellowGreen), yellowGreen) as TslNode;
  tint = tint.mul(mix(0.9, 1.08, macro.region.y)).mul(mix(0.93, 1.07, macro.patches.w)) as TslNode;
  tint = mix(tint, vec3(...tuning.dryOlive), smoothstep(0, 0.6, sunny).mul(tuning.dryOliveShare)) as TslNode;
  const straw = max(patchDry.mul(0.6), smoothstep(0.45, 1, sunny).mul(tuning.dryStrawShare)) as TslNode;
  // The cosmetic season (C1, season-ground-glsl.ts): the dry-grass mask leans to straw, then the season tint.
  const seasonDry = clamp(sunny.add(patchDry.mul(0.7)).add(0.4), 0, 1) as TslNode;
  tint = mix(tint, vec3(...MEADOW_TINT.dry), mix(straw, 1, season.w.mul(seasonDry))) as TslNode;
  tint = mix(vec3(1), tint, macro.far.mul(0.5).add(1)) as TslNode;
  tint = tint.mul(mix(vec3(1), vec3(...RAIN_LUSH_TINT), rain)) as TslNode;
  return mix(tint, vec3(...MEADOW_TINT.canopy), canopy.mul(0.8)).mul(season.xyz.add(1)) as TslNode;
};

export const snowTint = (macro: {
  breakup: TslNode; grain: TslNode; patches: TslNode; region: TslNode;
}, xz: TslNode, normal: TslNode) => {
  const warp = macro.patches.x.sub(0.5).mul(5).add(macro.region.z.sub(0.5).mul(9)) as TslNode;
  const ripples = sin(dot(xz, SNOW_WIND).mul(1.7).add(warp)).mul(0.5).add(0.5) as TslNode;
  const drifts = smoothstep(0.3, 0.8, macro.region.y) as TslNode;
  const tone = float(0.8).add(drifts.mul(0.07)).sub(ripples.mul(macro.breakup.x.mul(0.045).add(0.035)))
    .add(macro.grain.y.sub(0.5).mul(0.04)) as TslNode;
  const downhill = normal.xz.div(max(length(normal.xz), 0.001)) as TslNode;
  const lee = max(dot(downhill, SNOW_WIND), 0)
    .mul(smoothstep(0.02, 0.3, float(1).sub(normal.y))) as TslNode;
  const hollow = float(1).sub(smoothstep(0.2, 0.45, macro.patches.y)) as TslNode;
  const shade = mix(vec3(1), SNOW_SHADE, clamp(lee.mul(2.5).add(hollow.mul(0.3)), 0, 0.6)) as TslNode;
  return vec3(tone).mul(shade) as TslNode;
};

