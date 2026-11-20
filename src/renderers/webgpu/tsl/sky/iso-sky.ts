import type { IUniform } from "three";
import {
  clamp, dot, exp, float, Fn, If, max, mix, normalize, positionLocal, pow, smoothstep,
  varying, vec2, vec3, vec4
} from "three/tsl";
import { type Material, MeshBasicNodeMaterial } from "three/webgpu";

import { CLOUD_FIELD, CLOUD_HEIGHT } from "../../../../render-common/shaders/cloud-glsl";
import { colorSrgbDecode } from "../color-output";
import { createNoiseNodes } from "../noise";
import {
  bindColor,
  bindMatrix,
  bindScalar,
  bindTexture,
  bindVector,
  createUniformBindings,
  syncUniformBindings,
  type UniformBindings
} from "../uniform-bindings";
import { createAtmosphereNodes } from "./atmosphere";
import { createSkyColorTail } from "./color-tail";
import { createSkyModelNodes } from "./sky-model";

type TslNode = any; // TSL's generated types do not model the proxied node methods.
type SkyUniforms = Record<string, IUniform>;

export const isIsoSkyMaterial = (material: Material) =>
  (material.userData as { wgIsoSky?: boolean }).wgIsoSky === true;

/** GLSL three-clouds.ts fragment: gradient, sun/moon disc, cloud field and camera air. */
const createIsoSkyOutput = (bindings: UniformBindings, screen: TslNode): TslNode => {
  const uniforms = bindings.source;
  const colorTail = createSkyColorTail(bindings);
  const atmosphere = createAtmosphereNodes(bindings);
  const skyModel = createSkyModelNodes({
    ambientSky: bindVector(bindings, "uAmbientSky", 3),
    fogColor: bindVector(bindings, "uFogColor", 3),
    lutTexture: uniforms.uSkyViewLut ? bindTexture(bindings, "uSkyViewLut") : null,
    sunColor: bindVector(bindings, "uSunColor", 3)
  });
  const noiseTexture = uniforms.uNoiseTexture?.value;
  const noise = createNoiseNodes(noiseTexture);
  const inverseProjection = bindMatrix(bindings, "uInverseProjection");
  const cameraWorld = bindMatrix(bindings, "uCameraWorld");
  const background = bindColor(bindings, "uBackground") as TslNode;
  const daylightUniform = bindScalar(bindings, "uDaylight", 0) as TslNode;
  const ambientSky = bindVector(bindings, "uAmbientSky", 3) as TslNode;
  const fogColor = bindVector(bindings, "uFogColor", 3) as TslNode;
  const sunDirection = bindVector(bindings, "uSunDirection", 3) as TslNode;
  const cloudCover = bindScalar(bindings, "uCloudCover", 0) as TslNode;
  const cloudDrift = bindVector(bindings, "uCloudDrift", 2) as TslNode;

  const nearPoint = inverseProjection.mul(vec4(screen, -1, 1));
  const farPoint = inverseProjection.mul(vec4(screen, 1, 1));
  // Pinned before the cloud If (pitfall P33): values first built inside its body stay unset for
  // the rays that skip it (below the slab), which the gradient and camera air also read.
  const origin = cameraWorld.mul(vec4(nearPoint.xyz.div(nearPoint.w), 1)).xyz.toVar();
  const direction = normalize(cameraWorld.mul(vec4(farPoint.xyz.div(farPoint.w), 1)).xyz
    .sub(origin)).toVar() as TslNode;
  const horizon = smoothstep(-0.08, 0.12, direction.y).toVar();
  const daylight = clamp(max(max(ambientSky.r, ambientSky.g), ambientSky.b).mul(1.6), 0, 1)
    .toVar();
  const light = normalize(sunDirection).toVar() as TslNode;

  /** NOISE_GLSL + CLOUD_FIELD_GLSL cloudDensity. */
  const cloudDensity = (xz: TslNode): TslNode => {
    const noiseValue = noise.fbm3(xz.mul(CLOUD_FIELD.noiseScale)
      .add(cloudDrift.mul(CLOUD_FIELD.driftScale))) as TslNode;
    const edge = float(1).sub(cloudCover);
    return smoothstep(edge, edge.add(CLOUD_FIELD.edgeWidth), noiseValue);
  };

  const skyColor = skyModel.backdrop(direction, light, daylightUniform, background) as TslNode;
  const sunDot = dot(direction, light);
  const disc = smoothstep(0.9991, 0.99955, sunDot);
  const halo = pow(max(sunDot, 0), 18);
  const sunTint = mix(vec3(0.58, 0.7, 0.96), vec3(1, 0.86, 0.6), daylight);
  const litSky = mix(background, skyColor, horizon)
    .add(sunTint.mul(disc.mul(float(1.3).add(daylight.mul(2))).add(halo.mul(0.24))));

  // The cloud slab: grazing rays alias into ribbons, so distant puffs stay angular near the horizon.
  const verticalDirection = direction.y.abs().lessThan(0.001)
    .select(float(0.001), direction.y);
  const distanceToCloud = float(CLOUD_HEIGHT).sub(origin.y).div(verticalDirection);
  const angularBlend = float(1).sub(smoothstep(0.05, 0.2, direction.y));
  const angular = origin.xz.add(normalize(direction.xz)
    .mul(float(1200).add(direction.y.mul(1200))));
  const cloudField = float(0).toVar();
  const cloudColor = vec3(0).toVar();
  If(distanceToCloud.greaterThan(0), () => {
    const xz = mix(origin.xz.add(direction.xz.mul(distanceToCloud)), angular, angularBlend);
    const density = cloudDensity(xz);
    const lowerDistance = float(CLOUD_HEIGHT - 6).sub(origin.y).div(max(direction.y, 0.001));
    const upperDistance = float(CLOUD_HEIGHT + 6).sub(origin.y).div(max(direction.y, 0.001));
    const lower = cloudDensity(mix(origin.xz.add(direction.xz.mul(lowerDistance)),
      angular.sub(vec2(0, 8)), angularBlend));
    const upper = cloudDensity(mix(origin.xz.add(direction.xz.mul(upperDistance)),
      angular.add(vec2(0, 8)), angularBlend));
    const opacity = float(1).sub(exp(density.mul(0.8).add(lower.mul(0.35))
      .add(upper.mul(0.45)).negate()));
    const silver = clamp(dot(direction, light), 0, 1);
    const shade = clamp(float(0.8).add(upper.sub(lower).mul(0.15))
      .add(silver.mul(0.1)), 0.65, 1);
    const cloud = mix(fogColor, vec3(0.94, 0.95, 0.98).mul(daylight), 0.8).mul(shade);
    const haze = float(1).sub(smoothstep(900, 2800, distanceToCloud));
    cloudField.assign(opacity.mul(haze).mul(horizon));
    cloudColor.assign(cloud);
  });
  const color = mix(litSky, cloudColor, cloudField) as TslNode;
  const opticalDepth = atmosphere.opticalDepth(atmosphere.skyRay(direction));
  const finished = colorTail.output(atmosphere.compose(colorSrgbDecode(color), opticalDepth,
    direction));
  const belowHorizon = colorTail.output(atmosphere.compose(colorSrgbDecode(background),
    opticalDepth, direction));
  return horizon.lessThan(0.001).select(belowHorizon, finished) as TslNode;
};

/** TSL twin of the background-only iso sky (three-clouds.ts). */
export const createTslIsoSkyMaterial = (sourceMaterial: Material): Material | null => {
  if (!isIsoSkyMaterial(sourceMaterial)) return null;
  const uniforms = (sourceMaterial as { uniforms?: SkyUniforms }).uniforms;
  if (!uniforms?.uNoiseTexture?.value) return null;
  const bindings = createUniformBindings("iso-sky", uniforms);
  const screen = varying(positionLocal.xy, "vIsoScreen") as TslNode;
  const material = new MeshBasicNodeMaterial({
    depthTest: sourceMaterial.depthTest,
    depthWrite: sourceMaterial.depthWrite,
    side: sourceMaterial.side
  });
  material.name = "wg:iso-sky";
  // The fragment graph is an Fn so its If statements have a statement stack (TSL contract).
  material.colorNode = Fn(() => createIsoSkyOutput(bindings, screen))();
  material.vertexNode = vec4(positionLocal.xy, 1, 1);
  material.toneMapped = false;
  material.userData.wgPortedIsoSky = true;
  material.userData.syncUniforms = () => syncUniformBindings(bindings);
  return material;
};
