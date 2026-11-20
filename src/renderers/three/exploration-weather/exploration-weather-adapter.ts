/**
 * The frozen `ExplorationWeatherAdapter` plus optional render objects for EXPLORE-01G. The adapter
 * owns only presentation: it copies current environment values, reads camera positions and
 * injected read-only shelter/ground queries, and never receives the simulation, SaveStore, a command
 * dispatcher or gameplay RNG. Models are created by explicit preparation or `setActive(true)`.
 */
import type { Camera, IUniform, Object3D, WebGLRenderer } from "three";

import type { ExplorationWeatherAudioSink } from "../../../app/audio/exploration-weather";
import type { ExplorationWeatherAdapter } from "../../../app/exploration/contracts";
import type { EnvironmentState } from "../../../render-common/environment";
import type { ExplorationWeatherFrame } from "../../../render-common/exploration/exploration-frame";
import type { QualityPreset } from "../../../render-common/quality";
import {
  createExplorationLightningModel,
  type ExplorationLightningModel
} from "./exploration-lightning-model";
import {
  createExplorationLightningObject,
  type ExplorationLightningObject
} from "./exploration-lightning-object";
import {
  createExplorationRainField,
  type ExplorationRainField
} from "./exploration-rain-model";
import {
  createExplorationRainObject,
  createExplorationSplashObject,
  type ExplorationRainObject,
  type ExplorationSplashObject
} from "./exploration-rain-object";
import { createExplorationSkyObject, type ExplorationSkyObject } from "./exploration-sky-object";
import { createSkyPreparation } from "./exploration-sky-preparation";
import { updateSky } from "./exploration-sky-update";
import {
  createExplorationSplashField,
  type ExplorationSplashField
} from "./exploration-splash-model";
import {
  emptyLightning,
  emptyRainSample,
  emptySplashSample,
  type ExplorationWeatherAdapterStats,
  objectResources
} from "./exploration-weather-adapter-report";
import {
  copyExplorationWeatherEnvironment,
  EMPTY_EXPLORATION_WEATHER_ENVIRONMENT,
  EXPLORATION_WEATHER_HARD_CAPS,
  explorationPrecipitation,
  explorationWeatherBranch,
  explorationWeatherBudget,
  type ExplorationWeatherEnvironment
} from "./exploration-weather-profile";
import { mixPresentationSeed, PRESENTATION_WEATHER_SEED } from "./presentation-random";

export interface ExplorationWeatherCameraView {
  forwardX: number;
  forwardY: number;
  forwardZ: number;
  yaw: number;
}

export interface ExplorationWeatherRenderOptions {
  background: number;
  /** The renderer's shared uniforms: sky reads the existing wind, cloud cover, sun and colours. */
  uniforms: Record<string, IUniform>;
}

export interface ExplorationWeatherAdapterOptions {
  /** Exploration-only thunder owner. The adapter disposes it by default. */
  audio?: ExplorationWeatherAudioSink | null;
  cameraView?: () => ExplorationWeatherCameraView | null;
  createRenderObjects?: boolean;
  disposeAudio?: boolean;
  /** Current frame environment; the adapter copies the values and never retains the object. */
  environment?: () => Readonly<EnvironmentState> | null;
  /** Read-only splash surface height (the water surface over water) for bounded placement. */
  groundHeight?: (x: number, z: number) => number;
  maxAudioVoices?: number;
  maxDrops?: number;
  maxSplashes?: number;
  /** Injected presentation clock (ms). Never a simulation clock. */
  now?: () => number;
  /** Optional main scene root for the non-shadow world light. */
  parent?: Object3D | null;
  quality: QualityPreset;
  reducedFlash?: boolean;
  reducedMotion?: boolean;
  /** When omitted, the adapter is headless/model-only (unit tests and custom 01G effects). */
  render?: ExplorationWeatherRenderOptions | null;
  seed?: number;
  /** Bounded, coarse shelter lookup; no raycast is performed by this module. */
  shelterAt?: (x: number, z: number) => number;
  /** Open water at a point: ripple rings spawn only there (at most a few calls per frame). */
  waterAt?: (x: number, z: number) => boolean;
}

export interface ExplorationWeatherAdapterHandle extends ExplorationWeatherAdapter {
  /** Prepare only after an entry request; the lease releases a cancelled or completed visit's sky. */
  prepare: (renderer: WebGLRenderer, camera: Camera, preloadMoon?: boolean) => Promise<() => void>;
  /** Draw the exploration sky before the main scene; no-op if headless or inactive. */
  renderEffects: (renderer: WebGLRenderer, camera: Camera) => void;
  renderSky: (renderer: WebGLRenderer, camera: Camera) => void;
  setCameraView: (view: ExplorationWeatherCameraView | null) => void;
  setEnvironment: (environment: Readonly<EnvironmentState> | null) => void;
  skyStats: () => ReturnType<ExplorationSkyObject["stats"]> | null;
  stats: () => ExplorationWeatherAdapterStats;
}

const defaultNow = () =>
  typeof performance === "undefined" ? Date.now() : performance.now();

const finiteOr = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);

const copyView = (view: ExplorationWeatherCameraView): ExplorationWeatherCameraView => ({
  forwardX: finiteOr(view.forwardX, 0),
  forwardY: finiteOr(view.forwardY, 0),
  forwardZ: finiteOr(view.forwardZ, 1),
  yaw: finiteOr(view.yaw, 0)
});

/**
 * Builds the opt-in FPS weather presentation. Ordinary rendering is untouched when this adapter is
 * never created or `setActive` stays false; `explorationWeatherBranch(false)` is the explicit
 * default-parity assertion used by tests and 01G.
 */
export const createExplorationWeatherAdapter = (
  options: ExplorationWeatherAdapterOptions
): ExplorationWeatherAdapterHandle => {
  const seed = options.seed ?? PRESENTATION_WEATHER_SEED;
  const budget = explorationWeatherBudget(options.quality, {
    maxAudioVoices: options.maxAudioVoices,
    maxDrops: options.maxDrops,
    maxSplashes: options.maxSplashes
  });
  const now = options.now ?? defaultNow;
  const disposeAudio = options.disposeAudio ?? true;
  const renderObjects = options.createRenderObjects !== false;
  let active = false;
  let visualActive = false;
  let disposed = false;
  let lastNow: number | null = null;
  let lastAudioStrikeId = 0;
  let lastIntensity = 0;
  let strikes = 0;
  let explicitEnvironment: ExplorationWeatherEnvironment | null = null;
  let explicitView: ExplorationWeatherCameraView | null = null;
  let rainField: ExplorationRainField | null = null;
  let splashField: ExplorationSplashField | null = null;
  let lightningModel: ExplorationLightningModel | null = null;
  let sky: ExplorationSkyObject | null = null;
  let rainObject: ExplorationRainObject | null = null;
  let splashObject: ExplorationSplashObject | null = null;
  let lightningObject: ExplorationLightningObject | null = null;
  let rainSample = emptyRainSample();
  let splashSample = emptySplashSample();
  let lightningFrame = emptyLightning();
  const camera = { x: 0, y: 0, z: 0, yaw: 0 };

  const readEnvironment = (): ExplorationWeatherEnvironment | null => {
    if (explicitEnvironment) return explicitEnvironment;
    const source = options.environment?.();
    return source ? copyExplorationWeatherEnvironment(source) : null;
  };

  const readView = (): ExplorationWeatherCameraView => {
    if (explicitView) return explicitView;
    const source = options.cameraView?.();
    return source ? copyView(source) : { forwardX: 0, forwardY: 0, forwardZ: 1, yaw: 0 };
  };

  const ensureModels = () => {
    if (disposed) return false;
    if (!rainField && budget.drops > 0) {
      rainField = createExplorationRainField({
        capacity: budget.drops,
        height: budget.rainHeight,
        radius: budget.rainRadius,
        seed: mixPresentationSeed(seed, 0x1001),
        shelter: options.shelterAt,
        shelterProbeBudget: budget.shelterProbesPerFrame
      });
    }
    if (!splashField && budget.splashes > 0 && rainField) {
      const rippleCapacity = Math.min(
        EXPLORATION_WEATHER_HARD_CAPS.splashes,
        Math.max(1, Math.round(budget.splashes * 0.8))
      );
      splashField = createExplorationSplashField({
        rippleCapacity,
        rippleSpawnsPerUpdate: Math.min(2, budget.splashSpawnsPerFrame),
        seed: mixPresentationSeed(seed, 0x1002),
        splashCapacity: budget.splashes,
        splashSpawnsPerUpdate: budget.splashSpawnsPerFrame
      });
    }
    if (!lightningModel && budget.lightning) {
      lightningModel = createExplorationLightningModel({
        reducedFlash: options.reducedFlash ?? options.reducedMotion,
        seed: mixPresentationSeed(seed, 0x1003)
      });
    }
    if (renderObjects && options.render) {
      if (!sky) {
        sky = createExplorationSkyObject({
          background: options.render.background,
          uniforms: options.render.uniforms
        });
      }
      if (!rainObject && rainField) {
        rainObject = createExplorationRainObject({ capacity: budget.drops });
      }
      if (!splashObject && splashField) {
        splashObject = createExplorationSplashObject({
          rippleCapacity: splashField.rippleCapacity,
          splashCapacity: splashField.splashCapacity
        });
      }
      if (!lightningObject && budget.boltSegments > 0) {
        lightningObject = createExplorationLightningObject({
          parent: options.parent,
          segments: budget.boltSegments,
          seed: mixPresentationSeed(seed, 0x1004),
          worldLight: budget.worldLight
        });
      }
    }
    return true;
  };

  const hideObjects = () => {
    rainObject?.setVisible(false);
    splashObject?.update(emptySplashSample());
    if (lightningObject) lightningObject.update(emptyLightning());
  };

  const deactivateVisuals = () => {
    visualActive = false;
    lastNow = null;
    lastAudioStrikeId = 0;
    lastIntensity = 0;
    rainField?.reset();
    splashField?.reset();
    lightningModel?.reset();
    rainSample = emptyRainSample();
    splashSample = emptySplashSample();
    lightningFrame = emptyLightning();
    hideObjects();
  };

  const setActive = (next: boolean) => {
    if (disposed) return;
    if (next === active) return;
    active = next;
    if (active) {
      ensureModels();
      lastNow = null;
    } else {
      deactivateVisuals();
      // Unlike the small rain pools, the detailed lunar map belongs only to an active visit.
      sky?.dispose();
      sky = null;
    }
  };

  const setEnvironment = (environment: Readonly<EnvironmentState> | null) => {
    explicitEnvironment = environment ? copyExplorationWeatherEnvironment(environment) : null;
  };

  const setCameraView = (view: ExplorationWeatherCameraView | null) => {
    explicitView = view ? copyView(view) : null;
  };

  const readStats = (): ExplorationWeatherAdapterStats => ({
    active,
    audio: options.audio?.stats() ?? null,
    budget,
    camera: { ...camera },
    disposed,
    drops: {
      capacity: rainSample.capacity,
      count: rainSample.count,
      depthRejected: rainSample.depthRejected,
      sheltered: rainSample.sheltered,
      snowShare: rainSample.snowShare
    },
    lightning: {
      active: lightningFrame.active,
      cloudFlash: lightningFrame.cloudFlash,
      flash: lightningFrame.flash,
      strikes,
      worldLight: lightningFrame.worldLight
    },
    mode: explorationWeatherBranch(active).mode,
    rain: lastIntensity,
    resources: objectResources(
      sky?.stats() ?? null,
      rainObject?.stats() ?? null,
      splashObject?.stats() ?? null,
      lightningObject?.stats() ?? null
    ),
    splashes: {
      rippleCapacity: splashSample.rippleCapacity,
      rippleCount: splashSample.rippleCount,
      splashCapacity: splashSample.splashCapacity,
      splashCount: splashSample.splashCount,
      spawns: splashSample.spawns
    },
    wetness: lastIntensity
  });

  const update = (weather: ExplorationWeatherFrame | null) => {
    if (disposed || !active || !weather?.active) {
      if (visualActive) deactivateVisuals();
      return readStats();
    }
    if (!ensureModels()) return readStats();
    visualActive = true;
    const timeMs = finiteOr(Number(now()), 0);
    const delta = lastNow === null ? 0 : Math.min(0.15, Math.max(0, (timeMs - lastNow) / 1000));
    lastNow = timeMs;
    const view = readView(), currentEnvironment = readEnvironment();
    const environment = currentEnvironment ?? EMPTY_EXPLORATION_WEATHER_ENVIRONMENT;
    const { intensity, overcast, precipitation, snowShare } =
      explorationPrecipitation(currentEnvironment?.rain ?? weather.rain, currentEnvironment?.snow ?? 0);
    lastIntensity = intensity;
    const cameraX = finiteOr(weather.cameraX, 0), cameraY = finiteOr(weather.cameraY, 0);
    const cameraZ = finiteOr(weather.cameraZ, 0);
    camera.x = cameraX; camera.y = cameraY; camera.z = cameraZ;
    camera.yaw = view.yaw;

    if (rainField) {
      rainSample = rainField.update({
        cameraX,
        cameraY,
        cameraZ,
        deltaSeconds: delta,
        forwardX: view.forwardX,
        forwardY: view.forwardY,
        forwardZ: view.forwardZ,
        intensity: precipitation,
        snowShare,
        timeSeconds: timeMs / 1000,
        windX: environment.windX,
        windZ: environment.windZ
      });
    }
    if (splashField) {
      splashSample = splashField.update({
        cameraX,
        cameraY,
        cameraZ,
        deltaSeconds: delta,
        drops: rainSample.drops,
        intensity,
        surfaceY: options.groundHeight,
        waterAt: options.waterAt
      });
    }
    if (lightningModel) {
      lightningFrame = lightningModel.update({
        cameraX,
        cameraY,
        cameraZ,
        deltaSeconds: delta,
        rain: intensity,
        timeSeconds: timeMs / 1000,
        yaw: view.yaw
      });
      if (lightningFrame.strike && lightningFrame.strike.id !== lastAudioStrikeId) {
        lastAudioStrikeId = lightningFrame.strike.id;
        strikes++;
        options.audio?.play(lightningFrame.strike);
      }
    }
    updateSky({ camera, cloudDetail: budget.cloudDetail, environment,
      flash: lightningFrame.cloudFlash, groundHeight: options.groundHeight, overcast, sky,
      timeSeconds: timeMs / 1000 });
    rainObject?.update(rainSample);
    splashObject?.update(splashSample);
    lightningObject?.update(lightningFrame);
    return readStats();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    active = false;
    visualActive = false;
    lastNow = null;
    lastIntensity = 0;
    rainField?.dispose();
    splashField?.dispose();
    lightningModel?.dispose();
    sky?.dispose();
    rainObject?.dispose();
    splashObject?.dispose();
    lightningObject?.dispose();
    rainField = null;
    splashField = null;
    lightningModel = null;
    sky = null;
    rainObject = null;
    splashObject = null;
    lightningObject = null;
    rainSample = emptyRainSample();
    splashSample = emptySplashSample();
    lightningFrame = emptyLightning();
    if (disposeAudio) options.audio?.dispose();
  };

  return {
    prepare: createSkyPreparation({ cloudDetail: budget.cloudDetail, ensureModels, environment: readEnvironment,
      now, sky: () => sky, release: prepared => {
        if (sky !== prepared) return;
        sky.dispose(); sky = null;
      } }),
    dispose,
    renderEffects: (renderer, renderCamera) => {
      if (disposed || !active || !visualActive) return;
      lightningObject?.render(renderer, renderCamera);
      splashObject?.render(renderer, renderCamera);
      rainObject?.render(renderer, renderCamera);
    },
    renderSky: (renderer, renderCamera) => {
      if (disposed || !active || !visualActive) return;
      sky?.render(renderer, renderCamera);
    },
    setActive,
    setCameraView,
    setEnvironment,
    skyStats: () => sky?.stats() ?? null,
    stats: readStats,
    update
  };
};
