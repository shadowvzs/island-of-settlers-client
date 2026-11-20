import type { ExplorationSkyObject } from "./exploration-sky-object";
import { cloudCoverOverride } from "./exploration-sky-review-override";
import { explorationSunVisibility, type SunOcclusionPoint } from "./exploration-sun-occlusion";
import type { ExplorationWeatherEnvironment } from "./exploration-weather-profile";

interface SkyUpdateInput {
  camera: SunOcclusionPoint;
  cloudDetail: number;
  environment: ExplorationWeatherEnvironment;
  flash: number;
  groundHeight?: (x: number, z: number) => number;
  overcast: number;
  sky: ExplorationSkyObject | null;
  timeSeconds: number;
}

/** The possessed sky's per-frame values; optional chaining skips it when headless. */
export const updateSky = ({ camera, cloudDetail, environment, flash, groundHeight, overcast,
  sky, timeSeconds }: SkyUpdateInput) => {
  sky?.update({
    cloudCover: cloudCoverOverride(), cloudDetail, daylight: environment.daylight, flash,
    moonPhase: environment.moonPhase, moonSun: environment.moonSun, overcast,
    starPole: environment.starPole, starRotation: environment.starRotation,
    starlight: environment.starlight,
    sunVisibility: explorationSunVisibility(environment.sun, camera, groundHeight),
    timeSeconds
  });
};
