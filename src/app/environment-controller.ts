import { advanceRainbowMoisture } from "../render-common/atmosphere/rainbow";
import { computeEnvironment, TIME_PRESETS } from "../render-common/environment";
import { WORLD_TIME_SCALE } from "../render-common/environment-clock";
import { applyMonsoonWeather } from "../render-common/seasonal-appearance/monsoon-weather";
import {
  applySeasonPrecipitation,
  isSeasonSnowClimate,
  type ShownPrecipitation
} from "../render-common/seasonal-appearance/season-snowfall";
import type { SeasonWeights } from "../render-common/seasonal-appearance/season-weights";
import { DAY_HOURS_PER_SECOND, NIGHT_HOURS_PER_SECOND } from "../shared/environment/constants";
import {
  forwardHours, type HourTransition, hourTransitionSeconds, readHourTransition, readWeatherFade, type WeatherFade
} from "../shared/environment/environment-transitions";
import {
  nextWeather, type WeatherChainClimate, weatherDwellSeconds, weatherForClimate, type WeatherState
} from "../shared/environment/weather-states";
import { isNightHour } from "../shared/environment/world-clock";
import type { WorldEnvironmentReading } from "../shared/script-world/world-environment";
import { createStatefulRandom } from "../shared/world/rng";
import type { SunDirection } from "../shared/world/world-data";

/**
 * Real time to game time: three seconds is one game minute, so a full day takes 72 minutes.
 * Night is compressed to half of its dark span (16.5 min instead of 33 min); the saved time is
 * added to daylight (`shared/environment/world-clock.ts`). Presets and manual time changes keep
 * gliding at `TRANSITION_HOURS_PER_SECOND`.
 */
const TRANSITION_HOURS_PER_SECOND = 5;
/** Time-lapse speeds of the running day cycle (development panel, for time-lapse recordings). */
export const CYCLE_SPEEDS = Object.freeze([1, 2, 5, 10, 30, 60, 120, 240] as const);
export type CycleSpeed = typeof CYCLE_SPEEDS[number];
/** Rain and snowfall fade in and out over about 14 s (the old 2.8 s transition, five times slower). */
const WEATHER_FADE_PER_SECOND = 0.07 / WORLD_TIME_SCALE;
/** Clouds build and clear on the same slow scale, so shadows never snap after a shower. */
const CLOUD_FADE_PER_SECOND = 0.016 / WORLD_TIME_SCALE;

export type TimePreset = keyof typeof TIME_PRESETS;
/** Player choice: a natural sun/moon cycle with random rain, or a permanent clear day. */
export type DayMode = "nature" | "sun";

export interface EnvironmentControls {
  cycling: boolean;
  /** Time-lapse multiplier of the running day cycle; 1 = normal. Presentation only, never saved. */
  cycleSpeed: CycleSpeed;
  day: number;
  hour: number;
  mode: DayMode;
  raining: boolean;
  snowing: boolean;
}

export interface EnvironmentSavedState {
  cycling: boolean;
  day: number;
  hour: number;
  rain: number;
  snow: number;
  targetHour: number;
  targetRain: number;
  targetSnow: number;
  /** Fields added with the seeded weather chain; older saves restore without them. */
  weatherState?: WeatherState;
  weatherTimer?: number;
  cloudCover?: number;
  cloudTargetExtra?: number;
  randomState?: number;
}

export interface EnvironmentStart {
  cycling?: boolean;
  day?: number;
  hour: number;
  mode?: DayMode;
  rain: boolean;
  /** World seed for the seeded nature weather chain. */
  seed?: number;
  snow: boolean;
}

const initialWeatherState = (initial: { rain: boolean | number; snow: boolean | number }): WeatherState => {
  if (initial.snow) return "snow";
  if (initial.rain) return "rain";
  return "clear";
};

const weatherCloudExtra = (state: WeatherState) => {
  if (state === "storm") return .25;
  if (state === "cloudy") return .2;
  return 0;
};

/** Shortest signed distance between two clock hours. */
const hourDelta = (from: number, to: number) => ((to - from + 36) % 24) - 12;

const approach = (value: number, target: number, maxStep: number) =>
  value + Math.max(-maxStep, Math.min(maxStep, target - value));

/** Monsoon sleet on a snowy island: rain and storms fall as a rain and snow mix (no snow cover builds). */
const SLEET_TARGETS: Partial<Record<WeatherState, readonly [number, number, number]>> = {
  rain: [.7, .45, 0], storm: [.85, .5, .25]
};

/** Cloud cover the sky settles at for these precipitation amounts and the weather's extra cover. */
const settledCloudCover = (rain: number, snow: number, extra: number) => .45 + Math.max(rain, snow * .55) * .5 + extra;

/**
 * Time of day and weather with smooth transitions: preset buttons glide the clock to the new
 * hour, the cycle runs a full day in 72 minutes (one game minute per three real seconds) with a
 * half-length night, rain or snow fade in and out (never both: switching one on switches the
 * other off).
 */
export const createEnvironmentController = (baseSun: SunDirection, initial: EnvironmentStart) => {
  let day = Math.max(0, Math.floor(initial.day ?? 0));
  let hour = initial.hour;
  let targetHour = initial.hour;
  let cycling = initial.cycling ?? false;
  let cycleSpeed: CycleSpeed = 1;
  let mode = initial.mode ?? "sun";
  let snowyIsland = false;
  let rain = initial.rain && !initial.snow ? 1 : 0;
  let targetRain = rain;
  let snow = initial.snow ? 1 : 0;
  let targetSnow = snow;
  /** Post-rain moisture for the rainbow: presentation only, not saved (a load starts dry). */
  let afterRain = rain;
  let weatherState = initialWeatherState(initial);
  let cloudTargetExtra = weatherCloudExtra(weatherState);
  let cloudCover = settledCloudCover(rain, snow, cloudTargetExtra);
  /** Authored (cinematic) transitions; any other weather or clock change cancels them. Not saved. */
  let weatherFade: WeatherFade | null = null;
  /** The cosmetic global season of this island (render only, never saved). */
  let seasonSource: (() => SeasonWeights) | null = null;
  /** The frame's monsoon weight (0..1): the presentation chain's wet season (never the world environment). */
  let monsoon = 0;
  /** The global season's snow cover is mostly built (T1): the nature chain snows instead of raining. */
  let seasonSnowClimate = false;
  const shownPrecipitation: ShownPrecipitation = { rain: 0, snow: 0 };
  /** Real seconds of updates: the monsoon gust clock. Not saved. */
  let elapsed = 0;
  let hourTransition: HourTransition | null = null;
  const random = createStatefulRandom(initial.seed ?? 1);
  let weatherTimer = weatherDwellSeconds(weatherState, random);
  const listeners = new Set<(controls: EnvironmentControls) => void>();
  /** ENV0: the clock and weather follow the island's world environment (viewer override off). Not saved. */
  let following = false;
  let followedWeather: string | null = null;

  /** Targets for one weather state: rain, snow and the extra cloud cover. */
  const applyWeatherState = () => {
    const targets: Record<WeatherState, readonly [number, number, number]> = {
      clear: [0, 0, 0], cloudy: [0, 0, .2], rain: [1, 0, 0], snow: [0, 1, 0], storm: [1, 0, .25]
    };
    const sleet = snowyIsland && monsoon > 0 ? SLEET_TARGETS[weatherState] : undefined;
    const [nextRain, nextSnow, extra] = sleet ?? targets[weatherState];
    targetRain = nextRain; targetSnow = nextSnow; cloudTargetExtra = extra;
  };

  const getControls = (): EnvironmentControls => ({
    cycleSpeed,
    cycling,
    day,
    hour,
    mode,
    raining: targetRain > 0,
    snowing: targetSnow > 0
  });
  const notify = () => listeners.forEach((listener) => listener(getControls()));

  /** The hour a running transition ends at (saved instead of the hour it is passing through). */
  const settledClock = () => {
    if (!hourTransition) return { day, hour };
    return readHourTransition({ ...hourTransition, elapsed: hourTransition.seconds });
  };

  const advanceHourTransition = (transition: HourTransition, step: number) => {
    transition.elapsed += step;
    const reading = readHourTransition(transition);
    day = reading.day;
    hour = targetHour = reading.hour;
    if (reading.done) hourTransition = null;
  };

  const advanceClock = (step: number) => {
    if (hourTransition) {
      advanceHourTransition(hourTransition, step);
      return;
    }
    if (cycling) {
      const hoursPerSecond = isNightHour(hour) ? NIGHT_HOURS_PER_SECOND : DAY_HOURS_PER_SECOND;
      const previousHour = hour;
      hour = (hour + step * hoursPerSecond * cycleSpeed) % 24;
      if (hour < previousHour) day++;
      targetHour = hour;
    } else {
      const delta = hourDelta(hour, targetHour);
      hour =
        (hour +
          Math.sign(delta) * Math.min(Math.abs(delta), step * TRANSITION_HOURS_PER_SECOND) +
          24) %
        24;
    }
  };

  const advanceNatureChain = (step: number) => {
    if (mode !== "nature") return;
    weatherTimer -= step;
    if (weatherTimer > 0) return;
    weatherState = nextWeather(weatherState, chainClimate(), random);
    weatherTimer = weatherDwellSeconds(weatherState, random, monsoon);
    weatherFade = null;
    applyWeatherState();
    notify();
  };

  const advanceWeatherFade = (fade: WeatherFade, step: number) => {
    fade.elapsed += step;
    const reading = readWeatherFade(fade, { cloud: settledCloudCover(targetRain, targetSnow, cloudTargetExtra),
      rain: targetRain, snow: targetSnow });
    ({ rain, snow } = reading);
    cloudCover = reading.cloud;
    if (reading.done) weatherFade = null;
  };

  const advancePrecipitation = (step: number) => {
    if (weatherFade) {
      advanceWeatherFade(weatherFade, step);
      return;
    }
    rain = approach(rain, targetRain, step * WEATHER_FADE_PER_SECOND);
    snow = approach(snow, targetSnow, step * WEATHER_FADE_PER_SECOND);
    cloudCover = approach(cloudCover, settledCloudCover(rain, snow, cloudTargetExtra), step * CLOUD_FADE_PER_SECOND);
  };

  const update = (deltaSeconds: number) => {
    /** Never negative: a negative step would push the fades away from their targets. */
    const step = Math.min(Math.max(0, deltaSeconds), 0.1);
    elapsed += step;
    const season = seasonSource?.();
    monsoon = season?.monsoon ?? 0;
    seasonSnowClimate = isSeasonSnowClimate(season);
    if (!following) {
      advanceClock(step);
      advanceNatureChain(step);
    }
    advancePrecipitation(step);
    afterRain = advanceRainbowMoisture(afterRain, rain, step);
    const shown = applySeasonPrecipitation(rain, snow, season, shownPrecipitation);
    // Only the season's own snowfall adds its overcast (summer keeps the exact weather).
    const clouds = shown.snow > snow ? Math.max(cloudCover, settledCloudCover(0, shown.snow, 0)) : cloudCover;
    const environment = computeEnvironment(baseSun, hour, shown.rain, shown.snow, clouds, day);
    environment.afterRain = afterRain;
    environment.season = season;
    return applyMonsoonWeather(environment, monsoon, elapsed);
  };

  const climate = () => (snowyIsland || seasonSnowClimate ? "winter" : "temperate");

  /**
   * The nature chain's table: in a monsoon transition each draw follows the monsoon chain with the monsoon weight's
   * chance (one extra draw only while 0 < weight < 1), so summer keeps its exact sequence.
   */
  const chainClimate = (): WeatherChainClimate => {
    if (monsoon >= 1) return "monsoon";
    if (monsoon > 0 && random() < monsoon) return "monsoon";
    return climate();
  };

  /**
   * An authored weather change (campaign cinematics): the state's rain, snow and cloud targets, reached linearly
   * in `fadeSeconds` (0 snaps). The island's climate applies (no rain states in winter); the nature chain
   * resumes from the new state after its usual dwell.
   */
  const startWeatherFade = (fadeSeconds: number) => {
    weatherFade = { elapsed: 0, from: { cloud: cloudCover, rain, snow }, seconds: Math.max(0, fadeSeconds) };
    advanceWeatherFade(weatherFade, 0);
  };

  const setWeather = (state: WeatherState, fadeSeconds: number) => {
    // A monsoon allows rain on a snowy island too (it falls as sleet).
    weatherState = weatherForClimate(state, monsoon > 0 ? "monsoon" : climate());
    weatherTimer = weatherDwellSeconds(weatherState, random);
    applyWeatherState();
    startWeatherFade(fadeSeconds);
    notify();
  };

  /**
   * ENV0: the frame's world environment reading (the simulation's clock and weather, climate already applied), or
   * null to give the clock back to the viewer. A weather change fades like the natural chain, or over the script's
   * `transitionSeconds`; the first reading snaps, so a loaded island starts in its world weather.
   */
  const followWorld = (reading: WorldEnvironmentReading | null) => {
    following = reading !== null;
    if (!reading) {
      followedWeather = null;
      return;
    }
    day = reading.day;
    hour = targetHour = reading.hour;
    hourTransition = null;
    const key = `${reading.weather}:${reading.weatherFade?.tick ?? "chain"}`;
    if (key === followedWeather) return;
    const fadeSeconds = followedWeather === null ? 0 : reading.weatherFade?.seconds ?? null;
    followedWeather = key;
    weatherState = reading.weather;
    applyWeatherState();
    weatherFade = null;
    if (fadeSeconds !== null) startWeatherFade(fadeSeconds);
    notify();
  };

  /**
   * Forward-only hour change (cinematic `timeOfDay` step and quest claim effect): the clock runs forward to
   * `nextHour` over `seconds` (default 3 to 6 s by distance; 0 jumps), passing midnight counts a day. A cycling
   * clock carries on from there; the same hour is no change.
   */
  const transitionToHour = (nextHour: number, seconds?: number) => {
    hourTransition = null;
    const hours = forwardHours(hour, nextHour);
    if (hours === 0) return;
    const duration = Math.max(0, seconds ?? hourTransitionSeconds(hours));
    hourTransition = { day, elapsed: 0, from: hour, hours, seconds: duration };
    advanceHourTransition(hourTransition, 0);
    notify();
  };

  const saveState = (): EnvironmentSavedState => ({ ...settledClock(),
    targetHour: hourTransition ? settledClock().hour : targetHour, cycling, rain, targetRain, snow, targetSnow, weatherState, weatherTimer, cloudCover, cloudTargetExtra, randomState: random.getState() });
  const loadState = (saved: EnvironmentSavedState) => {
    day = Number.isFinite(saved.day) ? Math.max(0, Math.floor(saved.day)) : 0;
    hour=saved.hour;targetHour=saved.targetHour;cycling=saved.cycling;
    rain=saved.rain;targetRain=saved.targetRain;snow=saved.snow;targetSnow=saved.targetSnow;
    weatherState = saved.weatherState ?? initialWeatherState(saved);
    weatherTimer = Number.isFinite(saved.weatherTimer) ? saved.weatherTimer! : weatherDwellSeconds(weatherState, random);
    cloudTargetExtra = saved.cloudTargetExtra ?? weatherCloudExtra(weatherState);
    cloudCover = Number.isFinite(saved.cloudCover) ? saved.cloudCover! : settledCloudCover(rain, snow, cloudTargetExtra);
    if (Number.isFinite(saved.randomState)) random.setState(saved.randomState!);
    afterRain = rain;
    weatherFade = hourTransition = null;
    notify();
  };
  return {
    saveState, loadState,
    getControls,
    onChange: (listener: (controls: EnvironmentControls) => void) => listeners.add(listener),
    /** Nature follows the cycle and random rain; sun is a clear noon that never changes. */
    followWorld,
    setDayMode: (next: DayMode) => {
      mode = next;
      if (following) return;
      weatherFade = hourTransition = null;
      if (mode === "sun") {
        cycling = false;
        hour = targetHour = TIME_PRESETS.day;
        rain = targetRain = afterRain = 0;
        snow = targetSnow = 0;
        weatherState = "clear"; cloudTargetExtra = 0;
      } else {
        cycling = true;
        weatherTimer = weatherDwellSeconds(weatherState, random);
      }
      notify();
    },
    setSeasonSource: (source: (() => SeasonWeights) | null) => { seasonSource = source; },
    /** A snowy island switches the nature chain to the winter climate (no rain states). */
    setSnowy: (snowy: boolean) => {
      snowyIsland = snowy;
      if (!snowy || (weatherState !== "rain" && weatherState !== "storm")) return;
      weatherState = "cloudy";
      weatherTimer = weatherDwellSeconds(weatherState, random);
      weatherFade = null;
      applyWeatherState();
    },
    /** A faster speed also starts the cycle, so one choice gives the time-lapse. */
    setCycleSpeed: (speed: CycleSpeed) => {
      cycleSpeed = speed;
      if (speed > 1) cycling = true;
      notify();
    },
    setTime: (preset: TimePreset) => {
      cycling = false;
      hourTransition = null;
      targetHour = TIME_PRESETS[preset];
      notify();
    },
    setWeather,
    toggleCycle: () => {
      cycling = !cycling;
      notify();
    },
    toggleRain: () => {
      targetRain = targetRain > 0 ? 0 : 1;
      weatherFade = null;
      if (targetRain > 0) targetSnow = 0;
      weatherState = targetRain > 0 ? "rain" : "clear";
      cloudTargetExtra = weatherCloudExtra(weatherState);
      weatherTimer = weatherDwellSeconds(weatherState, random);
      notify();
    },
    toggleSnow: () => {
      targetSnow = targetSnow > 0 ? 0 : 1;
      weatherFade = null;
      if (targetSnow > 0) targetRain = 0;
      weatherState = targetSnow > 0 ? "snow" : "clear";
      cloudTargetExtra = weatherCloudExtra(weatherState);
      weatherTimer = weatherDwellSeconds(weatherState, random);
      notify();
    },
    transitionToHour,
    update
  };
};

export type EnvironmentController = ReturnType<typeof createEnvironmentController>;
