import type { Camera, WebGLRenderer } from "three";

import type { ExplorationSkyObject } from "./exploration-sky-object";
import {
  EMPTY_EXPLORATION_WEATHER_ENVIRONMENT,
  type ExplorationWeatherEnvironment
} from "./exploration-weather-profile";

interface SkyPreparationOptions {
  cloudDetail: number;
  ensureModels: () => boolean;
  environment: () => ExplorationWeatherEnvironment | null;
  now: () => number;
  release: (sky: ExplorationSkyObject) => void;
  sky: () => ExplorationSkyObject | null;
}

/** The entry lease owns cancellation as well as the visit's eventual resource release. */
export const createSkyPreparation = (options: SkyPreparationOptions) =>
  async (renderer: WebGLRenderer, camera: Camera, preloadMoon = true) => {
    options.ensureModels();
    const sky = options.sky();
    if (!sky) return () => undefined;
    const environment = options.environment() ?? EMPTY_EXPLORATION_WEATHER_ENVIRONMENT;
    sky.update({ cloudDetail: options.cloudDetail, daylight: preloadMoon ? environment.daylight : 1,
      flash: 0, moonPhase: environment.moonPhase, timeSeconds: options.now() / 1000 });
    const release = () => options.release(sky);
    try { await sky.prepare(renderer, camera); }
    catch (error) { release(); throw error; }
    return release;
  };
