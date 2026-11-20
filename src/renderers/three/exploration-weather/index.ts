/**
 * EXPLORE-01F FPS weather presentation. Nothing here is wired into the shared renderer yet; 01G
 * imports the adapter/factories and suppresses the ordinary sky/rain only while the exploration
 * weather frame is active. Ordinary isometric rendering stays on its existing modules.
 */
export {
  createExplorationLightningModel,
  type ExplorationLightningFrame,
  type ExplorationLightningModel,
  type ExplorationLightningModelOptions,
  type ExplorationLightningStrike,
  type ExplorationLightningUpdate
} from "./exploration-lightning-model";
export {
  type ExplorationLightningObject,
  type ExplorationLightningObjectOptions,
  type ExplorationLightningObjectStats
} from "./exploration-lightning-object";
export {
  createExplorationRainField,
  type ExplorationRainDrop,
  type ExplorationRainField,
  type ExplorationRainFieldOptions,
  type ExplorationRainFieldSample,
  type ExplorationRainFieldUpdate
} from "./exploration-rain-model";
export {
  type ExplorationRainObject,
  type ExplorationRainObjectOptions,
  type ExplorationRainObjectStats,
  type ExplorationSplashObject,
  type ExplorationSplashObjectOptions,
  type ExplorationSplashObjectStats
} from "./exploration-rain-object";
export {
  type ExplorationSkyObject,
  type ExplorationSkyObjectOptions,
  type ExplorationSkyObjectStats,
  type ExplorationSkyUpdate
} from "./exploration-sky-object";
export {
  createExplorationSplashField,
  type ExplorationSplash,
  type ExplorationSplashField,
  type ExplorationSplashFieldOptions,
  type ExplorationSplashFieldSample,
  type ExplorationSplashFieldUpdate
} from "./exploration-splash-model";
export {
  createExplorationWeatherAdapter,
  type ExplorationWeatherAdapterHandle,
  type ExplorationWeatherAdapterOptions,
  type ExplorationWeatherCameraView,
  type ExplorationWeatherRenderOptions
} from "./exploration-weather-adapter";
export {
  type ExplorationWeatherAdapterStats,
  type ExplorationWeatherResources
} from "./exploration-weather-adapter-report";
export {
  copyExplorationWeatherEnvironment,
  EXPLORATION_WEATHER_HARD_CAPS,
  type ExplorationWeatherBranch,
  explorationWeatherBranch,
  type ExplorationWeatherBudget,
  explorationWeatherBudget,
  type ExplorationWeatherEnvironment,
  type ExplorationWeatherMode,
  type ExplorationWeatherProfileOptions
} from "./exploration-weather-profile";
export {
} from "./presentation-random";
