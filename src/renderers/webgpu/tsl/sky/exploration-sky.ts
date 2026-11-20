import type { IUniform } from "three";
import {
  clamp, float, Fn, If, mix, normalize, positionLocal, smoothstep, varying,
  vec3, vec4
} from "three/tsl";
import { type Material, MeshBasicNodeMaterial } from "three/webgpu";

import { EXPLORATION_SKY_CONCEALMENT_TOP } from
  "../../../../render-common/atmosphere/exploration-sky-constants";
import { colorSrgbDecode } from "../color-output";
import {
  bindColor,
  bindComputed,
  bindMatrix,
  bindOptionalTexture,
  bindScalar,
  bindTexture,
  bindVector,
  createUniformBindings,
  syncUniformBindings,
  type UniformBindings
} from "../uniform-bindings";
import { createAtmosphereNodes } from "./atmosphere";
import { createTslCloudPass, type TslCloudPass } from "./cloud-pass";
import { createCloudNodes } from "./clouds";
import { createSkyColorTail } from "./color-tail";
import { createMoonNodes } from "./disc";
import { createSkyModelNodes } from "./sky-model";
import { createStarNodes } from "./stars";
import { createSunNodes } from "./sun";
import { SKY_FALLBACK_TEXTURE } from "./textures";
import { createSkyViewRay } from "./view-ray";

type TslNode = any; // TSL's generated types do not model the proxied node methods;
type SkyUniforms = Record<string, IUniform>;

export const isExplorationSkyMaterial = (material: Material) =>
  (material.userData as { wgExplorationSky?: boolean }).wgExplorationSky === true;

/** Every shared uniform graph of the possessed sky, built once per source material. */
const createSkyNodes = (bindings: UniformBindings) => {
  const uniforms = bindings.source;
  const colorTail = createSkyColorTail(bindings);
  const sunDirection = bindVector(bindings, "uSunDirection", 3) as TslNode;
  const cameraAltitude = bindComputed(bindings, () => {
    const matrix = uniforms.uCameraWorld?.value as { elements?: ArrayLike<number> };
    return Math.max(Number(matrix?.elements?.[13] ?? 0), 0);
  }) as TslNode;
  return {
    atmosphere: createAtmosphereNodes(bindings),
    cameraAltitude,
    clouds: createCloudNodes(bindings),
    colorTail,
    daylight: bindScalar(bindings, "uDaylight", 0) as TslNode,
    lightning: bindScalar(bindings, "uLightning", 0) as TslNode,
    moon: createMoonNodes(bindings,
      bindOptionalTexture(bindings, "uMoonTexture", SKY_FALLBACK_TEXTURE)),
    rainbowStrength: bindScalar(bindings, "uAtmosphereRainbow", 0) as TslNode,
    skyModel: createSkyModelNodes({
      ambientSky: bindVector(bindings, "uAmbientSky", 3),
      fogColor: bindVector(bindings, "uFogColor", 3),
      lutTexture: uniforms.uSkyViewLut ? bindTexture(bindings, "uSkyViewLut") : null,
      sunColor: bindVector(bindings, "uSunColor", 3)
    }),
    stars: createStarNodes(bindings),
    sun: createSunNodes(bindings, colorTail),
    sunDirection
  };
};

type SkyNodes = ReturnType<typeof createSkyNodes>;

/** EXPLORATION_SKY_FRAGMENT_GLSL: gradient, stars, moon, clouds, camera air and the HDR sun. */
const createSkyOutput = (bindings: UniformBindings, nodes: SkyNodes, screen: TslNode,
  sunDirectVisibility: TslNode, cloudPass: TslCloudPass): TslNode => {
  const inverseProjection = bindMatrix(bindings, "uInverseProjection");
  const cameraWorld = bindMatrix(bindings, "uCameraWorld");
  const view = createSkyViewRay(screen, inverseProjection, cameraWorld);
  // Values read inside several If bodies are pinned here, before the first If (pitfall P1): the
  // node builder assigns a shared node where it is first built, so a sun direction first built
  // in the night-only moon branch was never set by day (no sun, no aureole), and the air ray
  // first built in the horizon-band concealment branch left the sky's optical depth at 0.
  const direction = view.direction.toVar();
  const lightDirection = normalize(nodes.sunDirection).toVar();
  const eyeAltitude = nodes.cameraAltitude;
  const daylight = nodes.daylight.clamp(0, 1).toVar();
  const airRay = nodes.atmosphere.pinRay(nodes.atmosphere.skyRay(direction));

  /** GLSL explorationSkyConcealment: the veil only along the horizon band. */
  const skyOpticalDepth = (): TslNode => {
    const horizonBand = float(1).sub(smoothstep(0, EXPLORATION_SKY_CONCEALMENT_TOP,
      direction.y));
    const veil = float(0).toVar();
    If(horizonBand.greaterThan(0), () => {
      veil.assign(nodes.atmosphere.concealment(airRay).mul(horizonBand));
    });
    return nodes.atmosphere.opticalDepth(airRay).add(veil);
  };

  const skyColor = nodes.skyModel.backdrop(direction, lightDirection, daylight,
    bindColor(bindings, "uBackground")) as TslNode;
  const withStars = skyColor.add(nodes.stars.radiance(direction, lightDirection, skyColor));
  const withMoon = withStars.add(nodes.moon.radiance(direction, lightDirection));
  const high = nodes.clouds.highLayer(direction, eyeAltitude);
  const withHigh = mix(withMoon, high.color, high.opacity) as TslNode;
  // The volumetric cumulus comes from the half-resolution march + temporal resolve (TSL-3c).
  const cloud = nodes.clouds.lowerLayer(direction, eyeAltitude,
    () => cloudPass.sample(screen)) as TslNode;
  const cloudFade = smoothstep(-0.01, 0.035, direction.y) as TslNode;
  const cloudOpacity = clamp(cloud.a, 0, 1).mul(cloudFade).toVar() as TslNode;
  const clouded = withHigh.mul(float(1).sub(cloudOpacity))
    .add(cloud.rgb.mul(cloudFade)) as TslNode;
  const flashed = clouded.add(vec3(0.5, 0.64, 1).mul(nodes.lightning)
    .mul(float(0.08).add(cloudOpacity.mul(0.42))));
  const opticalDepth = skyOpticalDepth();
  const radiance = nodes.atmosphere.compose(colorSrgbDecode(flashed), opticalDepth,
    direction);
  const rainbow = vec3(0).toVar();
  If(nodes.rainbowStrength.greaterThan(0), () => {
    rainbow.assign(nodes.atmosphere.rainbow(direction).mul(sunDirectVisibility)
      .mul(nodes.atmosphere.airTransmittance(opticalDepth)));
  });
  const localTransmittance = float(1).sub(high.opacity).mul(float(1).sub(cloudOpacity)).toVar();
  const airTransmittance = nodes.atmosphere.airTransmittance(opticalDepth);
  const transmittedSun = nodes.sun.radiance(direction, lightDirection, localTransmittance,
    sunDirectVisibility).mul(airTransmittance);
  const glow = nodes.sun.cloudGlow(direction, lightDirection, float(1).sub(cloudOpacity),
    high.opacity).mul(airTransmittance);
  return nodes.sun.output(radiance.add(rainbow), transmittedSun, glow) as TslNode;
};

/**
 * TSL twin of the possessed sky (exploration-sky-object.ts): one fullscreen draw with the real
 * gradient, stars, moon, volumetric cloud texture, camera air and HDR sun. The vertex stage also
 * evaluates the sun's cloud visibility, as the GLSL does (it does not depend on the screen point).
 */
export const createTslExplorationSkyMaterial = (sourceMaterial: Material): Material | null => {
  if (!isExplorationSkyMaterial(sourceMaterial)) return null;
  const uniforms = (sourceMaterial as { uniforms?: SkyUniforms }).uniforms;
  if (!uniforms) return null;
  const bindings = createUniformBindings("sky", uniforms);
  const nodes = createSkyNodes(bindings);
  const screen = varying(positionLocal.xy, "vSkyScreen") as TslNode;
  // Flat per draw like the GLSL `vSunDirectVisibility`: four cloud transmittance marches per
  // vertex instead of per pixel.
  const directVisibility = varying(nodes.clouds.sunCloudVisibility(
    normalize(nodes.sunDirection), nodes.cameraAltitude), "vSunDirectVisibility") as TslNode;
  const material = new MeshBasicNodeMaterial({
    depthTest: false,
    depthWrite: false,
    side: sourceMaterial.side,
    transparent: false
  });
  material.name = "wg:sky";
  // The fragment graph is an Fn so its If statements have a statement stack (TSL contract).
  const cloudPass = createTslCloudPass({
    bindings,
    cameraAltitude: nodes.cameraAltitude,
    clouds: nodes.clouds,
    isActive: () => Number(uniforms.uCloudSamples?.value ?? 0) >= 1.5
      && Number(uniforms.uCloudCover?.value ?? 0) > 0.025,
    readDrift: () => uniforms.uCloudDrift!.value as ArrayLike<number>
  });
  material.colorNode = Fn(() =>
    createSkyOutput(bindings, nodes, screen, directVisibility, cloudPass))();
  material.vertexNode = vec4(positionLocal.xy, 1, 1);
  material.toneMapped = false;
  material.userData.wgPortedSky = true;
  material.userData.syncUniforms = () => syncUniformBindings(bindings);
  // The presenter runs this before it draws the sky scene (the WebGL sky's renderClouds).
  material.userData.renderPrepass = cloudPass.render;
  material.userData.prewarmPrepass = cloudPass.prewarm;
  material.addEventListener("dispose", cloudPass.dispose);
  return material;
};
