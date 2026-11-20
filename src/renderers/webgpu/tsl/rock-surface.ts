import {
  clamp,
  dot,
  float,
  floor,
  If,
  int,
  mix,
  normalize,
  smoothstep,
  step,
  vec2,
  vec3
} from "three/tsl";
import type { Texture } from "three/webgpu";

import { ROCK_MACRO_FORM_PULL, ROCK_PLANE_STRENGTH } from "../../../render-common/shaders/rock-tuning";
import {
  applyMountainDetail,
  applyOreStone,
  applyStoneDetail,
  applyStoneDetailNormal,
  getFineGrain,
  getRockDetailNormal,
  getRockNoise,
  getRunoff,
  type RockZones
} from "./rock-detail";
import {
  getRockPlanes,
  getRockSnowLine,
  getSnowColor,
  getSnowCover,
  getSnowNormal,
  getStrata,
  smoothstepDescending
} from "./rock-form";
import { getRockUv, sampleRockTriplanar } from "./rock-uv";

/**
 * TSL twin of `rock-glsl.ts` (ROCK_SURFACE_GLSL + the non-lite branches of ROCK_DETAIL_GLSL):
 * the packed-material zones, the stone palette, plane/strata form, shelf growth, wet rock, snow
 * and the close-up kinds. The texture and noise handles are injected by the material.
 */
type TslNode = any; // TSL's generated types do not model the proxied node methods.
type NoiseNode = (point: TslNode) => TslNode;

export interface RockSurfaceInputs {
  /** ROCK_LITE off: the fine grain, the mountain octave and the detail normals. */
  detailed: boolean;
  /** Explicit `fwidth(u)` of the joint kernels; the material omits it (shader derivatives). */
  fractureFootprint?: TslNode;
  fbm3: NoiseNode;
  getFractures(world: TslNode, normal: TslNode, turn: TslNode,
    uFootprint?: TslNode): TslNode;
  /** The landform normal (xyz) and its weight (w) at a world xz. */
  macroNormal(xz: TslNode): TslNode;
  rockNormal: Texture;
  rockTexture: Texture;
  snowAt(xz: TslNode): TslNode;
  /** Explicit `fwidth(layer)` of the strata kernel; the material omits it (shader derivatives). */
  strataFootprint?: TslNode;
  time: TslNode;
  valueNoise: NoiseNode;
  valueNoise4: NoiseNode;
}

export interface RockSurface {
  albedo: TslNode;
  detailed: TslNode;
  normal: TslNode;
  occlusion: TslNode;
  roughness: TslNode;
  snow: TslNode;
  zones: RockZones;
}

export interface RockSurfaceNodes {
  getRockDetailSurface(world: TslNode, normal: TslNode, mask: TslNode, extra: TslNode,
    footprint: TslNode): RockSurface;
  getRockSurface(world: TslNode, normal: TslNode, mask: TslNode, extra: TslNode,
    footprint: TslNode): RockSurface;
}

/**
 * Broad stone colour: regional palette (warm grey, brown-grey, mauve-grey, slate; restrained),
 * bed tone (band) on top; never one uniform grey.
 */
export const getStonePalette = (tint: TslNode, region: TslNode, band: TslNode): TslNode => {
  const slate = vec3(0.37, 0.39, 0.42);
  const warmGrey = vec3(0.47, 0.46, 0.44);
  const brownGrey = vec3(0.45, 0.4, 0.36);
  const mauve = vec3(0.45, 0.42, 0.44);
  let stone = mix(slate, warmGrey, smoothstep(0.15, 0.5, tint));
  stone = mix(stone, brownGrey, smoothstep(0.6, 0.95, tint).mul(0.6));
  stone = mix(stone, mauve, smoothstep(0.5, 0.7, region).mul(0.6));
  stone = mix(stone, slate, smoothstepDescending(0.45, 0.28, region).mul(0.6));
  const regionValue = float(0.78).add(smoothstep(0.3, 0.7, region).mul(0.22));
  const bed = mix(0.72, 1.18, band);
  stone = mix(stone, slate, smoothstepDescending(0.3, 0.05, band).mul(0.4));
  return mix(stone, warmGrey.mul(1.1), smoothstep(0.7, 0.95, band).mul(0.4))
    .mul(regionValue).mul(bed);
};

/** Material weights: wide blends, texture heights and world noise break the borders up. */
export const getRockZones = (mask: TslNode, weathering: TslNode, materials: TslNode,
  breakup: TslNode): RockZones => {
  const loose = smoothstep(0.22, 0.78,
    mask.z.add(materials.b.sub(0.4).mul(0.35)).add(breakup.mul(0.3)));
  const weathered = smoothstep(0.2, 0.8,
    weathering.add(float(0.5).sub(materials.r).mul(0.3)).add(materials.a.mul(0.15)))
    .mul(float(1).sub(loose));
  return { clean: float(1).sub(weathered).sub(loose), loose, weathered };
};

export const getCleanRock = (stone: TslNode, materials: TslNode): TslNode =>
  stone.mul(float(0.66).add(materials.r.mul(0.68)));

export const getWeatheredRock = (stone: TslNode, materials: TslNode, world: TslNode,
  normal: TslNode, mask: TslNode, detailed: boolean, valueNoise: NoiseNode,
  fbm3: NoiseNode): TslNode => {
  let color = stone.mul(vec3(0.9, 0.88, 0.85)).mul(float(0.74).add(materials.g.mul(0.52)));
  if (detailed) {
    const oxidation = smoothstep(0.66, 0.82, fbm3(world.xz.mul(0.13).add(world.y.mul(0.21))));
    color = mix(color, vec3(0.6, 0.46, 0.3).mul(float(0.5).add(materials.g)),
      oxidation.mul(0.25));
    color = color.mul(float(1).sub(
      getRunoff(world, normal, valueNoise).mul(float(0.14).add(mask.y.mul(0.1)))));
  }
  return color;
};

/** Gravel and soil, low contrast (no pockmarked tops); soil tone matches the ground's gravel. */
export const getLooseRock = (stone: TslNode, materials: TslNode, mask: TslNode): TslNode => {
  const soil = mix(vec3(0.43, 0.4, 0.35), vec3(0.34, 0.36, 0.27), mask.y.mul(0.6));
  const pebbles = smoothstep(0.25, 0.6, materials.b);
  return mix(soil, stone.mul(0.9), pebbles.mul(0.75))
    .mul(float(0.8).add(materials.b.mul(0.35)));
};

/** The three materials blended by the zones. */
export const getZoneAlbedo = (stone: TslNode, materials: TslNode, world: TslNode,
  normal: TslNode, mask: TslNode, zones: RockZones, detailed: boolean, valueNoise: NoiseNode,
  fbm3: NoiseNode): TslNode => getCleanRock(stone, materials).mul(zones.clean)
  .add(getWeatheredRock(stone, materials, world, normal, mask, detailed, valueNoise, fbm3)
    .mul(zones.weathered))
  .add(getLooseRock(stone, materials, mask).mul(zones.loose));

/**
 * Value structure by orientation: dusty, warmer, lighter upward planes, the main rock tone on
 * walls, cooler and darker undersides; plane tone and a lighter soft edge between planes.
 */
export const applyPlaneValues = (albedo: TslNode, planes: { edge: TslNode; normal: TslNode;
  tone: TslNode }, cavity: TslNode): TslNode => {
  const up = planes.normal.y;
  let toned = albedo.mul(mix(0.74, 1.12, smoothstep(-0.4, 0.85, up)));
  const dust = vec3(0.58, 0.56, 0.52).mul(float(0.85).add(dot(albedo, vec3(0.33)).mul(0.4)));
  toned = mix(toned, dust, smoothstep(0.6, 0.95, up).mul(0.18));
  toned = mix(toned, toned.mul(vec3(0.74, 0.77, 0.86)), smoothstepDescending(-0.05, -0.55, up));
  return toned.mul(float(1).add(planes.tone.mul(0.16))
    .add(planes.edge.mul(float(1).sub(cavity)).mul(0.1)));
};

/** Moss and dry grass on sheltered upward shelves, in patches; never on steep faces. */
export const applyShelfGrowth = (albedo: TslNode, normal: TslNode, mask: TslNode,
  patches: TslNode, breakup: TslNode): TslNode => {
  const shelf = smoothstep(0.6, 0.88, normal.y);
  const sheltered = clamp(mask.y.mul(0.9).add(mask.w.mul(0.6)), 0, 1);
  const growth = smoothstep(0.42, 0.7,
    shelf.mul(sheltered).add(patches.sub(0.5).mul(0.6)).add(breakup.mul(0.2)));
  const moss = vec3(0.3, 0.35, 0.24);
  const grass = vec3(0.39, 0.43, 0.3);
  const cover = mix(moss, grass, smoothstep(0.42, 0.62, patches))
    .mul(float(0.85).add(breakup.mul(0.3)));
  return mix(albedo, cover, growth.mul(shelf).mul(0.65));
};

/** Wet rock by falls and in gorges: subtly darker, moss tint only in patches on upward faces. */
export const applyWetRock = (albedo: TslNode, normal: TslNode, wetness: TslNode,
  breakup: TslNode): TslNode => {
  const darker = mix(albedo, albedo.mul(vec3(0.8, 0.81, 0.84)), wetness);
  const patches = smoothstep(0.62, 0.9, wetness.mul(0.7).add(breakup).add(0.35));
  const moss = patches.mul(smoothstep(0.1, 0.6, normal.y)).mul(smoothstep(0.3, 0.7, wetness));
  return mix(darker, darker.mul(vec3(0.72, 0.86, 0.6)), moss.mul(0.6));
};

/** The decoded tint byte: x tint 0..1, y detailed stone flag, z ORE code. */
export const decodeRockTint = (packedByte: TslNode): TslNode => {
  const packedTint = packedByte.mul(255);
  const detailed = step(127.5, packedTint);
  const stoneByte = floor(packedTint.add(0.5)).sub(128);
  const undetailed = vec3(packedTint.div(127), 0, 0);
  const stone = vec3(stoneByte.mod(16).div(15), 1, floor(stoneByte.div(16)));
  return detailed.lessThan(0.5).select(undetailed, stone);
};

/** Strata on exposed steep rock (layered 0..1): darker recessed seams, lit lips. */
export const applyStrata = (albedo: TslNode, strata: { lip: TslNode; seam: TslNode },
  layered: TslNode): TslNode => {
  const shade = float(1).add(strata.lip.mul(0.1)).mul(float(1).sub(strata.seam.mul(0.32)));
  return albedo.mul(mix(1, shade, layered));
};

/** The form normal: on the skin (macroForm 1) pulled toward the landform's normal. */
export const getFormNormal = (normal: TslNode, world: TslNode, macroForm: TslNode,
  macroNormal: (xz: TslNode) => TslNode): TslNode => {
  const macro = macroNormal(world.xz);
  return normalize(mix(normal, macro.xyz, float(ROCK_MACRO_FORM_PULL).mul(macroForm).mul(macro.w)));
};

/** Close-up detail per kind: ore stones, standalone stones, the mountain's second octave. */
const applyKindDetail = (albedo: TslNode, world: TslNode, normal: TslNode, tint: TslNode,
  zones: RockZones, breakup: TslNode, inputs: RockSurfaceInputs): TslNode => {
  const result = albedo.toVar();
  If(tint.y.greaterThan(0.5), () => {
    result.assign(applyStoneDetail(result.mul(1.08), world, normal, breakup,
      inputs.valueNoise, inputs.rockTexture));
  });
  If(tint.z.greaterThan(0), () => {
    result.assign(applyOreStone(result, world, int(tint.z), inputs.time, inputs.fbm3));
  }).Else(() => {
    if (inputs.detailed)
      result.assign(applyMountainDetail(result, world, normal, zones, breakup,
        inputs.rockTexture));
  });
  return result;
};

export const createRockSurfaceNodes = (inputs: RockSurfaceInputs): RockSurfaceNodes => {
  const getRockSurface = (world: TslNode, normalInput: TslNode, mask: TslNode, extra: TslNode,
    footprint: TslNode): RockSurface => {
    const normal = normalize(normalInput);
    const wetness = extra.w;
    const uv = getRockUv(world, normal);
    const materials = sampleRockTriplanar(inputs.rockTexture, uv);
    const tint = decodeRockTint(mask.x);
    const noise = getRockNoise(world, inputs.valueNoise4, inputs.fbm3);
    const breakup = noise.meso.x.sub(0.5);
    const weathering = extra.z.add(noise.regional.z.sub(0.5).mul(0.9)).add(breakup.mul(0.25));
    const zones = getRockZones(mask, weathering, materials, breakup);
    const formed = float(1).sub(tint.y);
    const form = getFormNormal(normal, world, extra.x, inputs.macroNormal);
    const planes = getRockPlanes(form, noise.regional.x, formed.mul(ROCK_PLANE_STRENGTH));
    const exposed = float(1).sub(zones.loose).mul(formed);
    const layered = float(1).sub(smoothstep(0.55, 0.85, form.y)).mul(exposed);
    const strata = getStrata(world, form, noise.regional.y, noise.meso.y, inputs.strataFootprint);
    const stone = getStonePalette(tint.x, noise.region, mix(0.45, strata.band, layered));
    let albedo = getZoneAlbedo(stone, materials, world, normal, mask, zones, inputs.detailed,
      inputs.valueNoise, inputs.fbm3);
    if (inputs.detailed)
      albedo = albedo.mul(getFineGrain(uv, zones.loose, footprint, inputs.valueNoise));
    const crevice = smoothstep(0.3, 0.9, mask.w);
    albedo = applyPlaneValues(albedo, planes, crevice);
    albedo = applyStrata(albedo, strata, layered);
    const clefts = inputs.getFractures(world, form, noise.regional.x, inputs.fractureFootprint)
      .mul(exposed);
    const fractures = clefts.x;
    albedo = albedo.mul(float(1).sub(fractures.mul(0.5))).mul(float(1).add(clefts.y.mul(0.12)));
    albedo = applyKindDetail(albedo, world, normal, tint, zones, breakup, inputs);
    albedo = applyShelfGrowth(albedo, normal, mask, noise.meso.w, breakup);
    albedo = applyWetRock(albedo, normal, wetness, breakup);
    const snowPatches = vec2(noise.regional.w, noise.meso.z);
    const snowSlope = normalize(mix(form, normal, 0.65));
    const snow = getSnowCover(world, snowSlope, mask, materials, snowPatches,
      getRockSnowLine(world, inputs.snowAt)).mul(float(1).sub(wetness));
    albedo = mix(albedo, getSnowColor(world, form, snowPatches), snow);
    albedo = albedo.mul(float(1).sub(crevice.mul(0.16).mul(float(1).sub(snow))));
    const cavity = materials.a.mul(float(0.16).add(zones.weathered.mul(0.1)))
      .mul(float(1).sub(zones.loose));
    const formShade = float(1).sub(fractures.mul(0.4))
      .mul(float(1).sub(strata.seam.mul(layered).mul(0.25)));
    const surfaceNormal: TslNode = normalize(
      mix(planes.normal as TslNode, getSnowNormal(form), snow) as TslNode);
    const occlusion = mix(
      float(1).sub(crevice.mul(0.45)).mul(float(1).sub(cavity)).mul(formShade),
      1, snow.mul(0.7));
    const dryRoughness = zones.clean.mul(0.8).add(zones.weathered.mul(0.88))
      .add(zones.loose.mul(0.95)).add(breakup.mul(0.12));
    const roughness = mix(mix(dryRoughness, 0.6, snow), 0.45, wetness.mul(0.6));
    return {
      albedo,
      detailed: tint.y,
      normal: surfaceNormal,
      occlusion,
      roughness,
      snow,
      zones
    };
  };

  /** The same surface plus the close-up detail normals and the damp/moss roughness. */
  const getRockDetailSurface = (world: TslNode, normalInput: TslNode, mask: TslNode,
    extra: TslNode, footprint: TslNode): RockSurface => {
    const normal = normalize(normalInput);
    const surface = getRockSurface(world, normal, mask, extra, footprint);
    const smoothNormal = surface.normal;
    const nearFade = float(1).sub(smoothstep(0.02, 0.08, footprint));
    let detailNormal: TslNode = getRockDetailNormal(surface.normal, getRockUv(world, normal),
      surface.zones, nearFade, inputs.rockNormal);
    const damp = mask.w.mul(smoothstep(0.3, 0.8, mask.y));
    let roughness: TslNode = mix(surface.roughness, 0.7, damp.mul(0.5));
    const moss = smoothstep(0.5, 0.8, mask.y).mul(surface.zones.weathered);
    roughness = mix(roughness, 0.95, moss);
    detailNormal = applyStoneDetailNormal(normal, world, detailNormal, surface.detailed,
      nearFade, inputs.rockNormal);
    detailNormal = normalize(
      mix(detailNormal as TslNode, smoothNormal as TslNode, surface.snow.mul(0.85)) as TslNode);
    roughness = mix(roughness, 0.55, surface.snow);
    return { ...surface, normal: detailNormal, roughness };
  };

  return { getRockDetailSurface, getRockSurface };
};
