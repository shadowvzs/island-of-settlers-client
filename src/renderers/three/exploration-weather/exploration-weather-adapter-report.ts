/** Shared adapter diagnostics; kept out of the adapter factory so its frame loop stays readable. */
import type { ExplorationThunderAudioStats } from "../../../app/audio/exploration-weather";
import type { ExplorationLightningFrame } from "./exploration-lightning-model";
import type { ExplorationLightningObjectStats } from "./exploration-lightning-object";
import type { ExplorationRainFieldSample } from "./exploration-rain-model";
import type { ExplorationRainObjectStats, ExplorationSplashObjectStats } from "./exploration-rain-object";
import type { ExplorationSkyObjectStats } from "./exploration-sky-object";
import type { ExplorationSplashFieldSample } from "./exploration-splash-model";
import type { ExplorationWeatherBudget } from "./exploration-weather-profile";

export interface ExplorationWeatherResources {
  geometries: number;
  lights: number;
  materials: number;
  renderTargets: number;
  textures: number;
}

export interface ExplorationWeatherAdapterStats {
  active: boolean;
  audio: ExplorationThunderAudioStats | null;
  budget: ExplorationWeatherBudget;
  camera: { x: number; y: number; z: number; yaw: number };
  disposed: boolean;
  drops: {
    capacity: number; count: number; depthRejected: number; sheltered: number; snowShare: number;
  };
  lightning: {
    active: boolean; cloudFlash: number; flash: number; strikes: number; worldLight: number;
  };
  mode: "iso" | "fps";
  rain: number;
  resources: ExplorationWeatherResources;
  splashes: {
    rippleCapacity: number; rippleCount: number; splashCapacity: number; splashCount: number;
    spawns: number;
  };
  wetness: number;
}

/** Empty samples let stats and tests inspect a disposed adapter without allocating new pools. */
export const emptyRainSample = (): ExplorationRainFieldSample => ({
  active: false, capacity: 0, count: 0, depthRejected: 0, drops: [], far: 1, intensity: 0,
  near: 0, radius: 0, sheltered: 0, snowShare: 0, windX: 0, windZ: 0
});

export const emptySplashSample = (): ExplorationSplashFieldSample => ({
  active: false, intensity: 0, rippleCapacity: 0, ripples: [], rippleCount: 0, spawns: 0,
  splashCapacity: 0, splashes: [], splashCount: 0
});

export const emptyLightning = (): ExplorationLightningFrame => ({
  active: false, cloudFlash: 0, flash: 0, strike: null, strikeId: 0, worldLight: 0
});

export const objectResources = (
  sky: ExplorationSkyObjectStats | null,
  rain: ExplorationRainObjectStats | null,
  splash: ExplorationSplashObjectStats | null,
  lightning: ExplorationLightningObjectStats | null
): ExplorationWeatherResources => ({
  geometries: (sky?.geometries ?? 0) + (rain?.geometries ?? 0) + (splash?.geometries ?? 0) +
    (lightning?.geometries ?? 0),
  lights: lightning?.lights ?? 0,
  materials: (sky?.materials ?? 0) + (rain?.materials ?? 0) + (splash?.materials ?? 0) +
    (lightning?.materials ?? 0),
  renderTargets: 0,
  textures: sky?.extraTextures ?? 0
});
