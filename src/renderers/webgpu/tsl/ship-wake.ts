import type { IUniform } from "three";
import {
  attribute, float, Fn, max, mix, positionLocal, pow, smoothstep, texture, varying, vec2, vec3
} from "three/tsl";
import { type Material, MeshBasicNodeMaterial, type Texture } from "three/webgpu";

import { WATER_FOAM_COLOR } from "../../../render-common/shaders/water-glsl";
import { SHIP_WAKE_FOAM } from "../../../render-common/ships/ship-wake-foam";
import { createFogNodes } from "./fog";
import { createLiveFogSampler } from "./live-fog";
import { createNoiseNodes } from "./noise";
import { sunShadowAt } from "./sun-shadow";
import { createSurfaceColorTail } from "./surface-output";
import {
  bindScalar, bindTexture, bindVector, createUniformBindings, syncUniformBindings
} from "./uniform-bindings";
import { createWaterMathNodes } from "./water-math";
import { createWaterSurfaceNodes } from "./water-surface";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

const FOAM = vec3(...WATER_FOAM_COLOR) as TslNode;
const F = SHIP_WAKE_FOAM;

interface WakeSource {
  uniforms?: Record<string, IUniform>;
}

/** SHIP-WAKE: the wake ribbon material is a RawShaderMaterial; the presenter recognises this tag. */
export const isShipWakeMaterial = (material: Material) =>
  (material as { userData?: { wg5ShipWake?: boolean } }).userData?.wg5ShipWake === true;

/** Foam of one wake vertex: thin Kelvin arms, the churned stern band and the faint fill between. */
const createWakeFoam = () => Fn(([along, lateral, age, halfWidth, beam, hullLength]:
[TslNode, TslNode, TslNode, TslNode, TslNode, TslNode]) => {
  const d = lateral.abs() as TslNode;
  const armWidth = float(F.armWidth).add(float(F.armAgeWidth).mul(age)) as TslNode;
  const armOffset = d.sub(halfWidth.mul(F.armOffset)).div(armWidth) as TslNode;
  const arms = armOffset.mul(armOffset).mul(-2).exp()
    .mul(float(F.armGain).sub(float(F.armGainAge).mul(age))) as TslNode;
  const churnHalf = beam.mul(float(F.churnHalfBeam).add(float(F.churnAgeHalf).mul(age))) as TslNode;
  const churn = d.div(churnHalf).pow(2).mul(-2).exp()
    .mul(float(F.churnGain).sub(float(F.churnAgeGain).mul(age)))
    .mul(smoothstep(hullLength.mul(F.churnStart), hullLength.mul(F.churnFull), along)) as TslNode;
  const fill = float(F.fillGain)
    .mul(float(1).sub(smoothstep(halfWidth.mul(F.fillInner), halfWidth.mul(F.fillOuter), d)))
    .mul(smoothstep(hullLength.mul(F.fillStart), hullLength.mul(F.fillEnd), along))
    .mul(float(1).sub(smoothstep(hullLength.mul(F.fillTailStart), hullLength.mul(F.fillTailEnd), along))) as TslNode;
  const edge = float(1).sub(smoothstep(halfWidth.mul(F.edgeStart), halfWidth, d)) as TslNode;
  return max(max(arms, churn), fill).mul(edge) as TslNode;
});

/**
 * TSL twin of the WebGL ship wake (three-ship-wakes.ts): the same ribbon lift, Kelvin-arm/ stern-
 * churn foam, water-field visibility, fog-of-war, cloud shadow, sun shadow, foam glare and colour
 * tail. The mesh is untransformed world-space geometry, so `positionNode` adds only the swell lift.
 */
export const createTslShipWakeMaterial = (sourceMaterial: Material): Material | null => {
  const source = sourceMaterial as WakeSource;
  const uniforms = source.uniforms;
  const waterField = uniforms?.uWaterField?.value as Texture | undefined;
  const noiseTexture = uniforms?.uNoiseTexture?.value as Texture | undefined;
  if (!uniforms || !waterField || !noiseTexture) return null;
  const bindings = createUniformBindings("ship-wake", uniforms);
  const time = bindScalar(bindings, "uTime") as TslNode;
  const worldSize = bindVector(bindings, "uWorldSize", 2) as TslNode;
  const waterFieldTexture = bindTexture(bindings, "uWaterField") as TslNode;
  const sun = bindVector(bindings, "uSunDirection", 3) as TslNode;
  const sunColor = bindVector(bindings, "uSunColor", 3) as TslNode;
  const ambientSky = bindVector(bindings, "uAmbientSky", 3) as TslNode;
  const viewDirection = bindVector(bindings, "uViewDirection", 3) as TslNode;
  const fogColor = bindVector(bindings, "uFogColor", 3) as TslNode;
  const explorationFog = bindScalar(bindings, "uExplorationFog") as TslNode;
  const fogOfWarLit = bindScalar(bindings, "uFogOfWarLit") as TslNode;
  const rain = bindScalar(bindings, "uRain") as TslNode;
  const highlight = bindScalar(bindings, "uHighlight") as TslNode;
  const cloudCover = bindScalar(bindings, "uCloudCover", 0) as TslNode;
  const cloudDrift = bindVector(bindings, "uCloudDrift", 2) as TslNode;
  const { fbm3, valueNoise } = createNoiseNodes(noiseTexture);
  const math = createWaterMathNodes({ highlight, time });
  const surface = createWaterSurfaceNodes({ cloudCover, cloudDrift, fbm3, sun, time, valueNoise });
  const fog = createFogNodes({ fbm3, liveFog: createLiveFogSampler(bindings), noiseTexture });
  const colorTail = createSurfaceColorTail(bindings);
  const wake = attribute("wake", "vec4") as TslNode;
  const shape = attribute("shape", "vec4") as TslNode;
  const interior = fog.getMapInterior(positionLocal.xz, worldSize) as TslNode;
  const lift = math.swell(positionLocal.xz).x.mul(math.swellCalm(shape.w, vec2(0, 0))).mul(interior) as TslNode;
  const lifted = positionLocal.add(vec3(0, lift.add(0.06), 0)) as TslNode;
  const vWorld = varying(lifted, "vWakeWorld") as TslNode;
  const vWake = varying(wake, "vWakeData") as TslNode;
  const vShape = varying(shape, "vWakeShape") as TslNode;
  const wakeFoam = createWakeFoam();
  const age = vWake.z as TslNode;
  const fade = vWake.w.mul(pow(float(1).sub(age), F.ageExponent))
    .mul(smoothstep(F.depthStart, F.depthEnd, vShape.w))
    .mul(smoothstep(F.alongStart, F.alongEnd, vWake.x)) as TslNode;
  const foam = wakeFoam(vWake.x, vWake.y, age, vShape.x, vShape.y, vShape.z).mul(fade).toVar() as TslNode;
  const field = texture(waterFieldTexture, vWorld.xz.div(max(worldSize, vec2(1e-6)))) as TslNode;
  const liveFog = createLiveFogSampler(bindings);
  const hidden = liveFog(field.z, vWorld.xz)
    .lessThan(float(0.24).add(valueNoise(vWorld.xz.mul(0.7)).mul(0.16))) as TslNode;
  const lace = mix(F.laceFloor, 1, surface.foamLace(vWorld.xz)) as TslNode;
  const tint = sunColor.mul(F.sunShare).add(ambientSky.mul(F.ambientShare)) as TslNode;
  const light = float(F.ambientBase).add(float(F.ambientSun).mul(sun.y.max(0)))
    .mul(surface.cloudShadow(vWorld.xz)) as TslNode;
  const color = FOAM.mul(tint).mul(float(F.foamBase).add(float(F.foamLight).mul(light)))
    .mul(mix(F.shadowFloor, 1, sunShadowAt(uniforms, vWorld)))
    .mul(math.foamGlare()).mul(lace) as TslNode;
  const fogged = colorTail(fog.applyFogOfWar(color, field.z, vWorld.xz, worldSize, time,
    explorationFog, fogOfWarLit, fogColor, rain, viewDirection, sun, sunColor)) as TslNode;
  const alpha = foam.mul(F.alpha).mul(hidden.select(0, 1)) as TslNode;
  const material = new MeshBasicNodeMaterial({
    depthTest: sourceMaterial.depthTest,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: sourceMaterial.polygonOffsetFactor,
    polygonOffsetUnits: sourceMaterial.polygonOffsetUnits,
    side: sourceMaterial.side,
    transparent: true
  });
  material.name = "wg5:ship-wake";
  material.positionNode = lifted;
  material.colorNode = fogged;
  material.opacityNode = alpha;
  material.toneMapped = false;
  material.userData.wg5Ported = true;
  material.userData.syncUniforms = () => syncUniformBindings(bindings);
  return material;
};
