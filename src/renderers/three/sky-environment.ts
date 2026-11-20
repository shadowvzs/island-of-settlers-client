import {
  DataTexture,
  DataUtils,
  EquirectangularReflectionMapping,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  PMREMGenerator,
  RGBAFormat,
  type Scene,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget
} from "three";

import type { EnvironmentState } from "../../render-common/environment";
import { createSkyEnvironmentSchedule } from "../../render-common/lighting/sky-environment-schedule";
import {
  getSkyLight,
  SKY_RADIANCE_MAP_HEIGHT,
  SKY_RADIANCE_MAP_WIDTH,
  writeSkyRadianceMap
} from "../../render-common/lighting/sky-irradiance";
import { BUILT_IN_AMBIENT_INTENSITY } from "./sky-light-probe";

/**
 * R05 environment reflection (Medium+): the shared sky radiance (the same source the SH9 ambient
 * projects) as a PMREM, assigned as `scene.environment` of the building and crowd scenes. Built-in
 * materials take only its specular part (the atmosphere hook removes Three's environment
 * diffuse, which the SH probe already provides), so metals reflect the sky and rough dielectrics
 * gain the small Fresnel sheen the Neutral tonemapper's toe expects.
 *
 * One game renderer owns the active environment at a time; scenes read it each light update.
 */
let activeEnvironment: Texture | null = null;

/** Gives a built-in light scene the active sky environment (null on Low/Minimal). */
export const applySkyEnvironment = (scene: Scene) => {
  if (scene.environment === activeEnvironment) return;
  scene.environment = activeEnvironment;
  scene.environmentIntensity = BUILT_IN_AMBIENT_INTENSITY;
};

const createSourceTexture = (pixels: Uint16Array) => {
  const texture = new DataTexture(pixels, SKY_RADIANCE_MAP_WIDTH, SKY_RADIANCE_MAP_HEIGHT,
    RGBAFormat, HalfFloatType);
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = LinearSRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.name = "sky-environment-source";
  return texture;
};

/** Owns the PMREM of one renderer; `update` bakes only when the schedule says so. */
export const createSkyEnvironment = (renderer: WebGLRenderer) => {
  const radiance = new Float32Array(SKY_RADIANCE_MAP_WIDTH * SKY_RADIANCE_MAP_HEIGHT * 4);
  const halfPixels = new Uint16Array(radiance.length);
  const source = createSourceTexture(halfPixels);
  const pmrem = new PMREMGenerator(renderer);
  const isDue = createSkyEnvironmentSchedule();
  let target: WebGLRenderTarget | null = null;
  let bakes = 0;
  const bake = (environment: EnvironmentState) => {
    writeSkyRadianceMap(environment, getSkyLight(environment), radiance);
    for (let index = 0; index < radiance.length; index++)
      halfPixels[index] = DataUtils.toHalfFloat(radiance[index]!);
    source.needsUpdate = true;
    // The first bake allocates the target; later bakes refill it, so the texture never changes.
    target = pmrem.fromEquirectangular(source, target);
    activeEnvironment = target.texture;
    bakes++;
  };
  return {
    /** `nowSeconds`: wall clock (the bake interval is real time, not game time). */
    update: (environment: EnvironmentState, nowSeconds: number) => {
      if (isDue(getSkyLight(environment), nowSeconds)) bake(environment);
    },
    stats: () => ({ bakes, textures: target ? 3 : 1 }),
    dispose: () => {
      if (target && activeEnvironment === target.texture) activeEnvironment = null;
      target?.dispose();
      source.dispose();
      pmrem.dispose();
    }
  };
};

export type SkyEnvironment = ReturnType<typeof createSkyEnvironment>;
