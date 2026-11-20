/**
 * Opt-in FPS sky: one fullscreen draw with an atmospheric gradient, a bounded Cartesian cloud
 * shell, and a sun/moon disc on the current environment light. It uses no render target, shadow
 * pass, or procedural moon texture. Medium/High own a 256 KiB cloud-noise volume; the local 2K
 * lunar albedo loads only when needed. Minimal borrows existing noise. Owned assets release on exit.
 */
import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  Color,
  type Data3DTexture,
  GLSL3,
  type IUniform,
  Matrix4,
  Mesh,
  RawShaderMaterial,
  Scene,
  Vector3,
  type WebGLRenderer
} from "three";

import { skyRadianceDefines } from "../../../render-common/atmosphere/sky-view-lut";
import {
  type SunRadianceInputs,
  writeMoonTint,
  writeSunAureoleRadiance,
  writeSunDiscRadiance
} from "../../../render-common/atmosphere/sun-radiance";
import { WORLD_TIME_SCALE } from "../../../render-common/environment-clock";
import { createSharedUniformValues } from "../../../render-common/shader-uniforms";
import type { SunDirection } from "../../../shared/world/world-data";
import { createExplorationCloudMotion } from "./exploration-cloud-motion";
import { createExplorationCloudPass, type ExplorationCloudPass } from "./exploration-cloud-pass";
import {
  createExplorationMoonTexture,
  type ExplorationMoonImageLoader,
  type ExplorationMoonTexture
} from "./exploration-moon-texture";
import { explorationCloudSampleCount } from "./exploration-sky-cloud-glsl";
import { explorationSkyCoverage } from "./exploration-sky-coverage";
import { writeMoonLitAxis } from "./exploration-sky-disc-glsl";
import { createExplorationSkyNoise } from "./exploration-sky-noise";
import {
  EXPLORATION_SKY_FRAGMENT_GLSL,
  EXPLORATION_SKY_VERTEX_GLSL
} from "./exploration-sky-shader";
import { createExplorationStarUniforms } from "./exploration-stars";

export interface ExplorationSkyObjectOptions {
  background: number;
  /** Optional review/test seam; production uses the bundled local asset loader. */
  moonImageLoader?: ExplorationMoonImageLoader;
  /** Shared renderer uniforms; wind, cloud cover and light values are referenced, not copied. */
  uniforms: Record<string, IUniform>;
}

export interface ExplorationSkyUpdate {
  /** Optional fixed coverage for native visual review; normal play derives it from weather. */
  cloudCover?: number;
  cloudDetail: number;
  daylight: number;
  flash: number;
  /** 0 new moon, 0.5 full, 0.75 last quarter; omitted keeps the legacy full moon. */
  moonPhase?: number;
  /** The sun that lights the moon (environment.ts moonSunDirection); omitted lights it from below. */
  moonSun?: SunDirection;
  /** 0 clear .. 1 full overcast; omitted follows the shared rain uniform. */
  overcast?: number;
  /** Celestial pole and sidereal angle of the night stars (environment.ts); omitted keeps them. */
  starPole?: SunDirection;
  starRotation?: number;
  /** 0 .. 1 sky darkness for stars (environment.ts starlightForHour); omitted follows daylight. */
  starlight?: number;
  /** Terrain-visible share of the sun disc (gates its glare); omitted means fully visible. */
  sunVisibility?: number;
  timeSeconds: number;
}

export interface ExplorationSkyObjectStats {
  cloudDetail: number;
  disposed: boolean;
  drawCalls: number;
  extraTextures: number;
  geometries: number;
  materials: number;
  moonLoaded: boolean;
  triangles: number;
}

export interface ExplorationSkyObject {
  dispose: () => void;
  prepare: (renderer: WebGLRenderer, camera: Camera) => Promise<void>;
  render: (renderer: WebGLRenderer, camera: Camera) => void;
  stats: () => ExplorationSkyObjectStats;
  update: (values: ExplorationSkyUpdate) => void;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

/** Elevation (radians) of the shared light vector, the direction the sky draws the disc on. */
const lightElevation = (uniform: IUniform) => {
  const vector = uniform.value as ArrayLike<number>;
  const y = vector[1] ?? 0, length = Math.hypot(vector[0] ?? 0, y, vector[2] ?? 0);
  return length > 0 ? Math.asin(Math.max(-1, Math.min(1, y / length))) : 0;
};

/** Keeps every shared uniform referenced so per-frame environment updates reach this material. */
const uniformOf = (
  uniforms: Record<string, IUniform>,
  name: string,
  fallback: IUniform["value"]
): IUniform => uniforms[name] ?? { value: fallback };

export const createExplorationSkyObject = (
  options: ExplorationSkyObjectOptions
): ExplorationSkyObject => {
  let disposed = false;
  let drawCalls = 0;
  let detail = 2;
  const inverseProjection = new Matrix4();
  const cameraWorld = new Matrix4();
  const background = new Color(options.background);
  const cloudSamples: IUniform = { value: explorationCloudSampleCount(detail) };
  const cloudCover: IUniform = { value: 0.45 };
  let cloudNoise: Data3DTexture | null = null;
  const cloudNoiseUniform: IUniform = { value: null };
  let cloudPass: ExplorationCloudPass | null = null;
  const cloudTexture: IUniform = { value: null };
  const cloudTextureReady: IUniform = { value: 0 };
  const daylight: IUniform = { value: 0.5 };
  const flash: IUniform = { value: 0 };
  const moonAvailable: IUniform = { value: 0 };
  const moonPhase: IUniform = { value: 0.5 };
  const moonLitAxis = new Float32Array([0, -1]);
  const moonTint = new Vector3();
  const sunAureole = new Vector3();
  const sunDisc = new Vector3();
  const sunVisibility: IUniform = { value: 1 };
  const sunInputs: SunRadianceInputs = { daylight: 0, elevation: 0, overcast: 0 };
  const sunRadiance = new Float32Array(3);
  const cloudMotion = createExplorationCloudMotion();
  const stars = createExplorationStarUniforms();
  const cloudDrift: IUniform = { value: cloudMotion.value };
  const wind = uniformOf(options.uniforms, "uWind", new Float32Array([0.8, 0.35]));
  let moonTexture: ExplorationMoonTexture | null = null;
  const moonTextureUniform: IUniform = { value: null };
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(
    new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3
  ));
  const material = new RawShaderMaterial({
    defines: skyRadianceDefines(options.uniforms),
    depthTest: false,
    depthWrite: false,
    fragmentShader: EXPLORATION_SKY_FRAGMENT_GLSL,
    glslVersion: GLSL3,
    uniforms: {
      ...Object.fromEntries(Object.entries(createSharedUniformValues())
        .filter(([name]) => name.startsWith("uAtmosphere"))
        .map(([name, value]) => [name, { value }])),
      ...options.uniforms,
      ...stars.uniforms,
      uAmbientSky: uniformOf(
        options.uniforms,
        "uAmbientSky",
        new Float32Array([0.14, 0.19, 0.33])
      ),
      uBackground: { value: background },
      uCameraWorld: { value: cameraWorld },
      uCloudCover: cloudCover,
      uCloudDrift: cloudDrift,
      uCloudNoise: cloudNoiseUniform,
      uCloudSamples: cloudSamples,
      uCloudTexture: cloudTexture,
      uCloudTextureReady: cloudTextureReady,
      uDaylight: daylight,
      uExplorationFog: uniformOf(options.uniforms, "uExplorationFog", 0),
      uFogColor: uniformOf(
        options.uniforms,
        "uFogColor",
        new Float32Array([0.24, 0.27, 0.36])
      ),
      uFogMap: uniformOf(options.uniforms, "uFogMap", null),
      uInverseProjection: { value: inverseProjection },
      uLightning: flash,
      uLiveFog: uniformOf(options.uniforms, "uLiveFog", 0),
      uMoonAvailable: moonAvailable,
      uMoonLitAxis: { value: moonLitAxis },
      uMoonPhase: moonPhase,
      uMoonTexture: moonTextureUniform,
      uMoonTint: { value: moonTint },
      uNoiseTexture: uniformOf(options.uniforms, "uNoiseTexture", null),
      uRain: uniformOf(options.uniforms, "uRain", 0),
      uSunAureole: { value: sunAureole },
      uSunColor: uniformOf(
        options.uniforms,
        "uSunColor",
        new Float32Array([0.3, 0.36, 0.55])
      ),
      uSunDirection: uniformOf(
        options.uniforms,
        "uSunDirection",
        new Float32Array([0.8, 0.5, 0.35])
      ),
      uSunDisc: { value: sunDisc },
      uSunVisibility: sunVisibility,
      uWorldSize: uniformOf(options.uniforms, "uWorldSize", new Float32Array([0, 0])),
    },
    vertexShader: EXPLORATION_SKY_VERTEX_GLSL
  });
  // The WebGPU presenter recognises the possessed sky by this tag and builds its TSL twin.
  material.userData.wgExplorationSky = true;
  const sunDirection = material.uniforms.uSunDirection!;

  /** HDR disc and aureole radiance through the air (sun-radiance.ts) and the terrain share. */
  const updateSun = (values: ExplorationSkyUpdate) => {
    sunInputs.daylight = daylight.value as number;
    sunInputs.elevation = lightElevation(sunDirection);
    sunInputs.overcast = values.overcast ?? Number(options.uniforms.uRain?.value ?? 0);
    sunDisc.fromArray(writeSunDiscRadiance(sunInputs, sunRadiance));
    sunAureole.fromArray(writeSunAureoleRadiance(sunInputs, sunRadiance));
    moonTint.fromArray(writeMoonTint(sunInputs.elevation, sunRadiance));
    if (values.moonSun) writeMoonLitAxis(sunDirection.value, values.moonSun, moonLitAxis);
    sunVisibility.value = clamp01(values.sunVisibility ?? 1);
  };
  const scene = new Scene();
  // The WebGPU presenter forwards this tagged scene's compile and draw calls to its TSL twin.
  scene.userData.wgExplorationSkyScene = true;
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  /** Medium/High own the noise volume and the half-resolution cloud pass; Low/Minimal neither. */
  const syncCloudResources = () => {
    if (detail > 1 && !cloudNoise) {
      cloudNoise = createExplorationSkyNoise();
      cloudNoiseUniform.value = cloudNoise;
      cloudPass = createExplorationCloudPass(material.uniforms);
      return;
    }
    if (detail > 1 || !cloudNoise) return;
    cloudNoise.dispose();
    cloudNoise = null;
    cloudNoiseUniform.value = null;
    cloudPass?.dispose();
    cloudPass = null;
    cloudTexture.value = null;
  };

  /** The volumetric clouds of this frame, before the sky pass reads them. */
  const renderClouds = (renderer: WebGLRenderer, camera: Camera) => {
    cloudTextureReady.value = 0;
    if (!cloudPass || (cloudCover.value as number) <= 0.025) return;
    cloudPass.render(renderer, camera);
    cloudTexture.value = cloudPass.texture.value;
    cloudTextureReady.value = 1;
  };

  const render = (renderer: WebGLRenderer, camera: Camera) => {
    if (disposed) return;
    if ((camera as Camera & { isOrthographicCamera?: boolean }).isOrthographicCamera) {
      drawCalls = 0;
      return;
    }
    camera.updateMatrixWorld();
    inverseProjection.copy(camera.projectionMatrixInverse);
    cameraWorld.copy(camera.matrixWorld);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      renderClouds(renderer, camera);
      renderer.render(scene, camera);
      drawCalls = 1;
    } catch (error) {
      drawCalls = 0;
      throw error;
    } finally {
      renderer.autoClear = autoClear;
    }
  };

  return {
    prepare: async (renderer, camera) => {
      if (disposed) return;
      if (cloudNoise) renderer.initTexture(cloudNoise);
      await Promise.all([renderer.compileAsync(scene, camera), cloudPass?.prepare(renderer, camera)]);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      drawCalls = 0;
      moonAvailable.value = 0;
      moonPhase.value = 0.5;
      moonTextureUniform.value = null;
      geometry.dispose();
      material.dispose();
      moonTexture?.dispose();
      cloudNoise?.dispose();
      cloudNoiseUniform.value = null;
      cloudPass?.dispose();
      cloudPass = null;
      cloudTexture.value = null;
      mesh.removeFromParent();
      scene.clear();
    },
    render,
    stats: () => ({
      cloudDetail: detail,
      disposed,
      drawCalls,
      extraTextures: disposed ? 0 : (moonTexture?.stats().live ?? 0) + Number(cloudNoise !== null),
      geometries: disposed ? 0 : 1,
      materials: disposed ? 0 : 1,
      moonLoaded: !disposed && (moonTexture?.stats().loaded ?? false),
      triangles: disposed ? 0 : 1
    }),
    update: (values) => {
      if (disposed) return;
      detail = Math.max(1, Math.min(3, Math.round(values.cloudDetail)));
      cloudSamples.value = explorationCloudSampleCount(detail);
      syncCloudResources();
      daylight.value = Math.max(0, Math.min(1, values.daylight));
      updateSun(values);
      moonPhase.value = Math.max(0, Math.min(1, values.moonPhase ?? 0.5));
      stars.update(values, detail, sunInputs.overcast);
      // Daytime visits need neither the lunar download nor its decoded/GPU image.
      if (daylight.value < 0.52 && !moonTexture) {
        moonTexture = createExplorationMoonTexture({
          loadImage: options.moonImageLoader,
          onReady: () => {
            if (disposed) return;
            moonTextureUniform.value = moonTexture?.texture ?? null;
            moonAvailable.value = 1;
          }
        });
      }
      flash.value = Math.max(0, Math.min(1, values.flash));
      const time = Number.isFinite(values.timeSeconds) ? values.timeSeconds : 0;
      const cloudTime = time / WORLD_TIME_SCALE;
      const windValues = wind.value as ArrayLike<number>;
      cloudDrift.value = cloudMotion.update(cloudTime, windValues[0] ?? 0, windValues[1] ?? 0);
      cloudCover.value = values.cloudCover ?? explorationSkyCoverage(
        cloudTime,
        Number(options.uniforms.uRain?.value ?? 0),
        Number(options.uniforms.uCloudCover?.value ?? 0.45)
      );
    }
  };
};
