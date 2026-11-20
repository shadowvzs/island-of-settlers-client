import type { IUniform } from "three";
import {
  abs, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, dot, exp, float,
  floor, Fn, fwidth, length, max, min, mix, normalize, positionWorld, reflect, screenCoordinate, sin, step,
  smoothstep, texture, uniform, varying, vec2, vec3, vec4
} from "three/tsl";
import { CustomBlending, MeshBasicNodeMaterial, NoBlending, OneFactor, OneMinusSrcAlphaFactor, type Material,
  type Texture } from "three/webgpu";

import { MAP_EDGE_CELLS } from "../../../render-common/shaders/common-glsl";
import { SEASON_ICE_RAMP } from "../../../render-common/shaders/season-ground-glsl";
import { MONSOON_RIPPLE, WATER_FOAM_COLOR, WATER_PALETTES,
  WATER_WAVE_TRAINS } from "../../../render-common/shaders/water-glsl";
import { OPEN_SEA_BED } from "../../../render-common/water-field";
import { colorSrgbEncode } from "./color-output";
import { createFogNodes } from "./fog";
import { createLiveFogSampler } from "./live-fog";
import { createNoiseNodes } from "./noise";
import { createAtmosphereNodes } from "./sky/atmosphere";
import { createSurfaceColorTail } from "./surface-output";
import { createWaterMathNodes } from "./water-math";
import { createWaterSurfaceNodes } from "./water-surface";
import { bindScalar, bindTexture, bindVector, bindVector3Array, createUniformBindings,
  syncUniformBindings, type UniformBindings } from "./uniform-bindings";
import { decodeTslWaterDepth } from "./water-depth";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

const WAVES = WATER_WAVE_TRAINS;
const FOAM = vec3(...WATER_FOAM_COLOR);
const SEA_BED = vec3(...OPEN_SEA_BED);

interface WaterSource {
  uniforms: Record<string, IUniform>;
  userData?: { winterWater?: boolean };
}

/**
 * Water surface for the node renderer: the shared swell, wind ripples, depth absorption, Fresnel
 * sky reflection, sun glints, surf foam and the no-refraction premultiplied layer.
 *
 * C-2 plugs in through the `WaterPassInputs` interface below: this material uses the no-refraction
 * fallback (deep scatter + SH9 sky reflection) until the refraction capture and the SSR pass exist.
 */
export interface WaterPassInputs {
  /** Refracted seabed colour at the pixel, or null while the capture is unavailable. */
  refractionColor?: (uv: TslNode) => TslNode | null;
  /** Scene depth at the pixel, or null while no depth pass is bound. */
  sceneDepth?: (uv: TslNode) => TslNode | null;
  /** Reflection radiance in the mirror direction, or null for the SH9 fallback. */
  reflectionColor?: (direction: TslNode, uv: TslNode) => TslNode | null;
  /** 0..1 confidence of the reflection/depth inputs; 0 means use the fallback. */
  confidence?: TslNode;
}

/**
 * Share of the winter water palette (water-glsl.ts getWinterWaterShare): full in the prepared winter, else the
 * global season's ice ramp of uSeasonCover.w, so the colour blends without a rebuild (seasons-6).
 */
const getWinterWaterShare = (bindings: UniformBindings, preparedWinter: boolean) => {
  if (preparedWinter) return float(1) as TslNode;
  if (!bindings.source.uSeasonCover) return float(0) as TslNode;
  const cover = bindVector(bindings, "uSeasonCover", 4) as TslNode;
  return smoothstep(SEASON_ICE_RAMP[0], SEASON_ICE_RAMP[1], cover.w) as TslNode;
};

const blendWaterPalette = (winterShare: TslNode) => {
  const { normal, winter } = WATER_PALETTES;
  return {
    absorption: mix(vec3(...normal.absorption), vec3(...winter.absorption), winterShare) as TslNode,
    scatterDeep: mix(vec3(...normal.deep), vec3(...winter.deep), winterShare) as TslNode,
    scatterShallow: mix(vec3(...normal.shallow), vec3(...winter.shallow), winterShare) as TslNode
  };
};

export const createTslWaterMaterial = (sourceMaterial: Material,
  inputs: WaterPassInputs = {}): Material | null => {
  const source = (sourceMaterial as unknown as WaterSource).uniforms
    ? (sourceMaterial as unknown as WaterSource)
    : null;
  const uniforms = source?.uniforms;
  const waterField = uniforms?.uWaterField?.value as Texture | undefined;
  const noiseTexture = uniforms?.uNoiseTexture?.value as Texture | undefined;
  const waterNormals = uniforms?.uWaterNormals?.value as Texture | undefined;
  if (!source || !uniforms || !waterField || !noiseTexture || !waterNormals) return null;
  const bindings = createUniformBindings("water", uniforms);
  const winter = source.userData?.winterWater === true;
  const winterShare = getWinterWaterShare(bindings, winter);
  const { absorption, scatterDeep, scatterShallow } = blendWaterPalette(winterShare);
  const worldSize = bindVector(bindings, "uWorldSize", 2) as TslNode;
  const safeSize = max(worldSize, vec2(1)) as TslNode;
  const viewport = bindVector(bindings, "uViewport", 2) as TslNode;
  const time = bindScalar(bindings, "uTime") as TslNode;
  const rain = bindScalar(bindings, "uRain") as TslNode;
  const highlight = bindScalar(bindings, "uHighlight") as TslNode;
  const math = createWaterMathNodes({ highlight, time });
  const sun = bindVector(bindings, "uSunDirection", 3) as TslNode;
  const sunColor = bindVector(bindings, "uSunColor", 3) as TslNode;
  const sunGlintColor = bindVector(bindings, "uSunGlint", 3) as TslNode;
  const ambientSky = bindVector(bindings, "uAmbientSky", 3) as TslNode;
  const fogColor = bindVector(bindings, "uFogColor", 3) as TslNode;
  const viewDirection = bindVector(bindings, "uViewDirection", 3) as TslNode;
  const explorationFog = bindScalar(bindings, "uExplorationFog") as TslNode;
  const fogOfWarLit = bindScalar(bindings, "uFogOfWarLit") as TslNode;
  const cloudCover = bindScalar(bindings, "uCloudCover", 0) as TslNode;
  const season = bindVector(bindings, "uSeason", 4) as TslNode;
  const cloudDrift = bindVector(bindings, "uCloudDrift", 2) as TslNode;
  const normalsTexture = bindTexture(bindings, "uWaterNormals") as TslNode;
  const skyReflectionCoefficients = bindVector3Array(bindings, "uSkyReflection", 9);
  const { fbm3, valueNoise } = createNoiseNodes(noiseTexture);
  const orthographic = uniform(0).onRenderUpdate(({ camera }) =>
    ((camera as { isOrthographicCamera?: boolean } | null)?.isOrthographicCamera ? 1 : 0));

  const skyBand = (coefficients: TslNode[], normal: TslNode) =>
    coefficients[1]!.mul(normal.y).add(coefficients[2]!.mul(normal.z))
      .add(coefficients[3]!.mul(normal.x)) as TslNode;
  const skyQuadratic = (coefficients: TslNode[], normal: TslNode) =>
    coefficients[4]!.mul(normal.x.mul(normal.y)).add(coefficients[5]!.mul(normal.y.mul(normal.z)))
      .add(coefficients[6]!.mul(normal.z.mul(normal.z).mul(3).sub(1)))
      .add(coefficients[7]!.mul(normal.x.mul(normal.z)))
      .add(coefficients[8]!.mul(normal.x.mul(normal.x).sub(normal.y.mul(normal.y)))) as TslNode;
  const skyReflection = (direction: TslNode): TslNode =>
    max(skyReflectionCoefficients[0]!.add(skyBand(skyReflectionCoefficients, direction))
      .add(skyQuadratic(skyReflectionCoefficients, direction)), vec3(0)) as TslNode;
  const { cloudShadow, foamLace } = createWaterSurfaceNodes({
    cloudCover, cloudDrift, fbm3, sun, time, valueNoise
  });
  const dissolveFoam = (lace: TslNode, age: TslNode): TslNode =>
    smoothstep(age, age.add(0.16), lace) as TslNode;
  const shoreFoam = (xz: TslNode, coast: TslNode, depth: TslNode, sea: TslNode): TslNode => {
    const age = math.surfAge(xz, coast) as TslNode;
    const lace = foamLace(xz) as TslNode;
    const surfZone = smoothstep(-6.0, -2.0, coast).mul(float(1).sub(smoothstep(-1.0, -0.15, coast)))
      .mul(sea) as TslNode;
    const surf = dissolveFoam(lace, float(0.3).add(age.mul(1.1))).mul(math.surfFreshness(age))
      .mul(surfZone).mul(math.surfSections(xz)) as TslNode;
    const swash = float(1).sub(smoothstep(0.02,
      float(0.07).add(math.surfFreshness(age).mul(math.surfFreshness(age)).mul(0.11)), depth)) as TslNode;
    const edge = swash.mul(dissolveFoam(lace, float(0.12).add(age.mul(0.45))))
      .mul(float(1).sub(sea)) as TslNode;
    return clamp(max(surf, edge).mul(0.9), 0, 1) as TslNode;
  };
  const waterFoamCover = (xz: TslNode, depth: TslNode, coast: TslNode, flow: TslNode): TslNode => {
    const speed = length(flow) as TslNode;
    const riverFoam = smoothstep(1.1, 2.2, speed)
      .mul(smoothstep(0.45, 0.8, valueNoise(xz.sub(flow.mul(time)).mul(2.2)))) as TslNode;
    const sea = float(1).sub(smoothstep(0.02, 0.2, speed)) as TslNode;
    const foam = max(shoreFoam(xz, coast, depth, sea), riverFoam)
      .mul(smoothstep(0, 0.03, depth)) as TslNode;
    return foam.mul(0.8) as TslNode;
  };


  const rainRingNoise = (uv: TslNode): TslNode =>
    texture(noiseTexture, uv).g as TslNode;
  const rainRings = (p: TslNode): TslNode => {
    const scaled = p.mul(1.6) as TslNode;
    const cell = floor(scaled) as TslNode;
    const seed = rainRingNoise(cell.add(0.5).div(211)) as TslNode;
    const random = vec2(seed, seed.mul(7.3).fract()) as TslNode;
    const offset = scaled.fract().sub(0.5).sub(random.sub(0.5).mul(0.5)) as TslNode;
    const cycle = time.mul(0.8).add(seed.mul(9)) as TslNode;
    const age = cycle.fract() as TslNode;
    const live = step(0.33, seed.mul(13.7).add(floor(cycle).mul(0.618)).fract()) as TslNode;
    const reach = float(0.3).add(seed.mul(31.1).fract().mul(0.22)) as TslNode;
    const distance = length(offset) as TslNode;
    const direction = offset.div(max(distance, 0.001)) as TslNode;
    const wobble = float(1).add(float(0.13).mul(sin(dot(direction, vec2(3.1, 1.7)).mul(2)
      .add(seed.mul(40))))) as TslNode;
    const radius = age.mul(reach).mul(wobble) as TslNode;
    const ring = sin(distance.sub(radius).mul(55)).mul(smoothstep(0.06, 0,
      abs(distance.sub(radius)))) as TslNode;
    const fade = float(1).sub(age).mul(float(1).sub(age)) as TslNode;
    return direction.mul(ring).mul(fade).mul(live).mul(1.1) as TslNode;
  };

  const rippleSlope = (xz: TslNode): TslNode => {
    const a = texture(normalsTexture, xz.mul(0.11).add(vec2(WAVES[0].direction[0],
      WAVES[0].direction[1]).mul(time.mul(0.0117)))).rg.mul(2).sub(1) as TslNode;
    const b = texture(normalsTexture, xz.mul(0.23).add(vec2(WAVES[1].direction[0],
      WAVES[1].direction[1]).mul(time.mul(0.0167)))).ba.mul(2).sub(1) as TslNode;
    const rings = rain.greaterThan(0.01).select(rainRings(xz).mul(rain), vec2(0)) as TslNode;
    return a.add(b.mul(0.6)).mul(float(0.22).add(rain.mul(0.12))
      .add(season.w.mul(MONSOON_RIPPLE))).add(rings) as TslNode;
  };
  const waterNormal = (xz: TslNode, flow: TslNode): TslNode => {
    const phaseA = float(time.mul(0.4).fract()) as TslNode;
    const phaseB = float(time.mul(0.4).fract().add(0.5).fract()) as TslNode;
    const offsetA = flow.mul(phaseA).mul(2) as TslNode;
    const offsetB = flow.mul(phaseB).mul(2) as TslNode;
    const mixB = abs(phaseA.sub(0.5)).mul(2) as TslNode;
    const advected = mix(rippleSlope(xz.sub(offsetA)), rippleSlope(xz.sub(offsetB).add(13.7)),
      mixB) as TslNode;
    const ripples = length(flow).lessThanEqual(0.01)
      .select(rippleSlope(xz), advected) as TslNode;
    return normalize(vec3(ripples.x, 1, ripples.y)) as TslNode;
  };

  const glintSunWeight = (): TslNode => {
    const height = sun.y as TslNode;
    return smoothstep(0.02, 0.1, height).mul(float(1).sub(smoothstep(0.22, 0.42, height))) as TslNode;
  };
  const sunGlint = (normal: TslNode, clouds: TslNode, view: TslNode): TslNode => {
    const weight = glintSunWeight() as TslNode;
    const alignment = max(dot(normal, normalize(sun.add(view))), 0) as TslNode;
    const glint = alignment.pow(220).mul(2.2).mul(weight).mul(clouds) as TslNode;
    return sunGlintColor.mul(float(0.8).mul(glint).div(float(0.4).add(glint))).mul(highlight) as TslNode;
  };
  const daySunGlint = (normal: TslNode, clouds: TslNode, view: TslNode): TslNode => {
    const variance = fwidth(normal) as TslNode;
    const weight = smoothstep(0.18, 0.4, sun.y).mul(float(1).sub(cloudCover.mul(0.7))) as TslNode;
    const spread = float(1).add(float(40).mul(variance.x.add(variance.y).add(variance.z))) as TslNode;
    const sharpness = mix(320, 90, rain).div(spread) as TslNode;
    const alignment = max(dot(normal, normalize(sun.add(view))), 0) as TslNode;
    const glint = alignment.pow(sharpness).mul(1.6).mul(weight).mul(clouds).div(spread) as TslNode;
    return sunGlintColor.mul(float(0.7).mul(glint).div(float(0.5).add(glint))).mul(highlight) as TslNode;
  };

  const shadeLayer = (xz: TslNode, depth: TslNode, coast: TslNode, flow: TslNode,
    normal: TslNode, view: TslNode): { color: TslNode; transmit: TslNode } => {
    const lightTint = sunColor.mul(0.6).add(ambientSky.mul(0.6)) as TslNode;
    const scatter = mix(scatterShallow, scatterDeep, smoothstep(1, 5.5, depth)).mul(lightTint) as TslNode;
    const clouds = cloudShadow(xz) as TslNode;
    const light = float(0.65).add(float(0.45).mul(max(dot(normal, sun), 0))).mul(clouds) as TslNode;
    const scattered = float(1).sub(exp(depth.mul(-0.4))) as TslNode;
    const color = scatter.mul(light).mul(scattered) as TslNode;
    const transmit = exp(depth.mul(absorption).negate()).mul(float(1).sub(scattered)) as TslNode;
    const reflection = math.waterFresnel(dot(normal, view)) as TslNode;
    const sky = skyReflection(reflect(view.negate(), normal)) as TslNode;
    const withReflection = color.mul(float(1).sub(reflection)).add(sky.mul(reflection))
      .add(sunGlint(normal, clouds, view)).add(daySunGlint(normal, clouds, view)) as TslNode;
    const reflectedTransmit = transmit.mul(float(1).sub(reflection)) as TslNode;
    const foamCover = waterFoamCover(xz, depth, coast, flow) as TslNode;
    const foamColor = FOAM.mul(lightTint).mul(float(0.75).add(float(0.25).mul(light)))
      .mul(math.foamGlare()) as TslNode;
    const colorWithFoam = mix(withReflection, foamColor, foamCover) as TslNode;
    const transmitWithFoam = reflectedTransmit.mul(float(1).sub(foamCover)) as TslNode;
    const surface = smoothstep(0, 0.04, depth) as TslNode;
    return {
      color: colorWithFoam.mul(surface) as TslNode,
      transmit: transmitWithFoam.mul(surface).add(float(1).sub(surface)) as TslNode
    };
  };

  const mapInterior = (xz: TslNode): TslNode => {
    const inside = min(xz, worldSize.sub(xz)) as TslNode;
    const edge = smoothstep(0, MAP_EDGE_CELLS, min(inside.x, inside.y)) as TslNode;
    return worldSize.x.lessThanEqual(0).select(float(1), edge) as TslNode;
  };

  const worldPosition = positionWorld as TslNode;
  const water = attribute("water", "vec4") as TslNode;
  const flow = water.zw as TslNode;
  const lifted = worldPosition.add(vec3(0, math.swell(worldPosition.xz).x
    .mul(math.swellCalm(water.x, flow)).mul(mapInterior(worldPosition.xz)), 0)) as TslNode;
  const vWorld = varying(lifted, "vWaterWorld") as TslNode;
  const vWater = varying(water, "vWaterData") as TslNode;
  const vWaterWorld = vWorld as TslNode;

  const field = texture(waterField, vWaterWorld.xz.div(safeSize)) as TslNode;
  const depth = decodeTslWaterDepth(field.x) as TslNode;
  const coast = field.y.sub(0.5).mul(16) as TslNode;
  const visibility = field.z as TslNode;
  const surfaceDepth = max(depth, 0) as TslNode;
  const swellSlope = math.swell(vWaterWorld.xz).yz.mul(math.swellSlopeWeight(surfaceDepth, vWater.zw)) as TslNode;
  const ripples = waterNormal(vWaterWorld.xz, vWater.zw) as TslNode;
  // GLSL: normalize(waterNormal + vec3(-swell.x, 0, -swell.y)); `ripples` is already the unit normal.
  const normal = normalize(ripples.sub(vec3(swellSlope.x, 0, swellSlope.y))) as TslNode;
  const view = orthographic.greaterThan(0.5)
    .select(viewDirection, normalize(cameraPosition.sub(vWaterWorld))) as TslNode;
  const layer = shadeLayer(vWaterWorld.xz, surfaceDepth, coast, vWater.zw, normal, view) as {
    color: TslNode; transmit: TslNode;
  };
  const interior = mapInterior(vWaterWorld.xz) as TslNode;
  const shade = mix(math.waterShadowFloor(depth), 1, 1) as TslNode;
  const fog = createFogNodes({ fbm3, liveFog: createLiveFogSampler(bindings), noiseTexture });
  const colorTail = createSurfaceColorTail(bindings);
  const atmosphere = createAtmosphereNodes(bindings);
  const airToward = (linear: TslNode): TslNode => atmosphere.compose(linear,
    atmosphere.surfaceTau(vWaterWorld), atmosphere.viewDirection(vWaterWorld)) as TslNode;
  const seen = dot(layer.transmit, vec3(1 / 3)).mul(interior).mul(shade) as TslNode;
  const waterColor = layer.color.add(SEA_BED.mul(layer.transmit)
    .mul(float(1).sub(interior))) as TslNode;
  const foggedLayer = fog.applyFogOfWar(waterColor.mul(shade), visibility,
    vWaterWorld.xz, worldSize, time, explorationFog, fogOfWarLit, fogColor, rain, view, sun, sunColor) as TslNode;
  // GLSL colorOutputPremultiplied + camera air: the tail runs on the straight colour, the surface
  // source and its alpha then cross the same air segment as the opaque seabed would.
  const premultipliedLayer = Fn(() => {
    const coverage = max(max(float(1).sub(seen), max(foggedLayer.r, max(foggedLayer.g, foggedLayer.b))),
      1 / 255) as TslNode;
    const tau = atmosphere.surfaceTau(vWaterWorld) as TslNode;
    const transmittance = atmosphere.airTransmittance(tau) as TslNode;
    const airlight = colorTail(colorSrgbEncode(atmosphere.airlight(atmosphere.viewDirection(vWaterWorld),
      tau))) as TslNode;
    const source = colorTail(foggedLayer.div(coverage)).mul(coverage) as TslNode;
    return vec4(source.mul(transmittance).add(airlight.mul(float(1).sub(transmittance))),
      float(1).sub(transmittance.mul(seen)).clamp(0, 1));
  })() as TslNode;
  const screenUv = screenCoordinate.xy.div(max(viewport, vec2(1))) as TslNode;
  const refracted = inputs.refractionColor
    ? inputs.refractionColor(screenUv.add(normal.xz.mul(float(0.25).mul(min(depth, 1)))))
    : null;
  let refractedColor: TslNode = null;
  if (refracted !== null) {
    const bed = mix(SEA_BED, colorSrgbEncode(refracted), interior) as TslNode;
    const foggedSurface = fog.applyFogOfWar(layer.color.add(bed.mul(layer.transmit)).mul(shade),
      visibility, vWaterWorld.xz, worldSize, time, explorationFog, fogOfWarLit, fogColor, rain, view, sun,
      sunColor) as TslNode;
    // GLSL finishSurface: the capture excluded camera air; the opaque water surface applies it once.
    refractedColor = Fn(() => colorTail(foggedSurface, airToward))() as TslNode;
  }

  const material = new MeshBasicNodeMaterial({
    depthTest: sourceMaterial.depthTest,
    depthWrite: refracted !== null ? sourceMaterial.depthWrite : false,
    side: sourceMaterial.side,
    transparent: refracted === null
  });
  material.name = winter ? "wg3:water-winter" : "wg3:water";
  material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(lifted, 1)) as TslNode;
  if (refracted !== null) {
    material.colorNode = refractedColor as TslNode;
    material.blending = NoBlending;
  } else {
    material.colorNode = premultipliedLayer.rgb as TslNode;
    material.opacityNode = premultipliedLayer.a as TslNode;
    material.blending = CustomBlending;
    material.blendSrc = OneFactor;
    material.blendDst = OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = OneFactor;
    material.blendDstAlpha = OneMinusSrcAlphaFactor;
  }
  material.toneMapped = false;
  material.userData.wg3Ported = true;
  material.userData.syncUniforms = () => syncUniformBindings(bindings);
  return material;
};
