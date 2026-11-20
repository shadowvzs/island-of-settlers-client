import { secondsToTicks, TICK_SECONDS } from "../../../../island-of-settlers-shared/src/time/constants";
import { HOURS_PER_DAY } from "../environment/constants";
import { forwardHours, hourTransitionSeconds, readHourTransition } from "../environment/environment-transitions";
import {
  nextWeather, type WeatherClimate, weatherDwellSeconds, weatherForClimate, type WeatherState
} from "../environment/weather-states";
import { type ClockHour, clockHourOf, clockSecondsOf } from "../environment/world-clock";
import { THEME_COUNT } from "../world/generation/island-themes";
import { createStatefulRandom, deriveSeed } from "../world/rng";
import type { WorldData } from "../world/world-data";
import {
  CLIMATE_SAMPLE_STRIDE, DEFAULT_START_HOUR, MAX_REPORTED_HOURS, SNOWY_THEME, WEATHER_SEED_LABEL, WINTER_SHARE
} from "./constants";
import type { SavedWorldEnvironment, WorldHourTransition, WorldWeatherFade } from "./world-environment-save";

/**
 * The world environment of an island whose map script reads the hour or the weather (trigger design §6.11, ENV0):
 * the map clock and the seeded weather chain as simulation state, driven by the script clock (frozen in offline
 * catch-up like every other script time) and changed only by script actions. Nothing the player does reaches it;
 * the presentation controller follows it (viewer override disabled). The clock is closed-form between anchors
 * (`world-clock.ts`), so a reading never depends on how often it is taken.
 */

export interface WorldEnvironmentReading extends ClockHour {
  weather: WeatherState;
  weatherFade: WorldWeatherFade | null;
}

/** The script conditions' three weather states: cloudy counts as clear, storm as rain. */
export type ScriptWeather = "clear" | "rain" | "snow";

/** Winter climate: a winter expedition, or an island mostly covered by the snowy theme. */
export const worldClimate = (world: Pick<WorldData, "expeditionTheme" | "themeWeights">): WeatherClimate => {
  if (world.expeditionTheme === "winter") return "winter";
  const weights = world.themeWeights;
  let snowy = 0, samples = 0;
  for (let index = SNOWY_THEME; index < weights.length; index += THEME_COUNT * CLIMATE_SAMPLE_STRIDE) {
    snowy += weights[index]!;
    samples += 1;
  }
  return samples > 0 && snowy / samples > WINTER_SHARE ? "winter" : "temperate";
};

export const scriptWeatherOf = (state: WeatherState): ScriptWeather => {
  if (state === "snow") return "snow";
  if (state === "rain" || state === "storm") return "rain";
  return "clear";
};

const startWeather = (world: WorldData): WeatherState => {
  if (world.environmentDefaults?.snow) return "snow";
  if (world.environmentDefaults?.rain) return "rain";
  return "clear";
};

const dwellTicks = (state: WeatherState, random: () => number) =>
  Math.max(1, secondsToTicks(weatherDwellSeconds(state, random)));

const initialState = (world: WorldData, climate: WeatherClimate, random: () => number): SavedWorldEnvironment => {
  const weather = weatherForClimate(startWeather(world), climate);
  const hour = world.environmentDefaults?.hour ?? DEFAULT_START_HOUR;
  return {
    anchorClock: clockSecondsOf({ day: 0, hour }),
    anchorTick: 0,
    cycling: world.environmentDefaults?.cycling ?? true,
    hourSeen: Math.floor(hour),
    random: 0,
    transition: null,
    weather,
    weatherChangeTick: dwellTicks(weather, random),
    weatherFade: null
  };
};

const transitionEnd = (transition: WorldHourTransition) => transition.startTick + transition.ticks;

const transitionEndClock = (transition: WorldHourTransition) =>
  clockSecondsOf(readHourTransition({ ...transition, elapsed: 1, seconds: 1 }));

export const createWorldEnvironment = (world: WorldData, saved?: SavedWorldEnvironment) => {
  const climate = worldClimate(world);
  const random = createStatefulRandom(deriveSeed(world.seed, WEATHER_SEED_LABEL));
  const state = saved ? structuredClone(saved) : initialState(world, climate, random);
  if (saved) random.setState(saved.random);

  /** The clock at a (possibly fractional) script tick. */
  const clockAt = (tick: number): ClockHour => {
    const transition = state.transition;
    if (transition && tick < transitionEnd(transition)) {
      const elapsed = Math.max(0, tick - transition.startTick);
      return readHourTransition({ ...transition, elapsed, seconds: transition.ticks });
    }
    const anchorTick = transition ? transitionEnd(transition) : state.anchorTick;
    const anchorClock = transition ? transitionEndClock(transition) : state.anchorClock;
    const elapsed = state.cycling ? (tick - anchorTick) * TICK_SECONDS : 0;
    return clockHourOf(anchorClock + Math.max(0, elapsed));
  };

  const settleTransition = (tick: number) => {
    const transition = state.transition;
    if (!transition || tick < transitionEnd(transition)) return;
    state.anchorClock = transitionEndClock(transition);
    state.anchorTick = transitionEnd(transition);
    state.transition = null;
  };

  const stepWeather = (tick: number) => {
    while (state.weatherChangeTick <= tick) {
      state.weather = nextWeather(state.weather, climate, random);
      state.weatherChangeTick += dwellTicks(state.weather, random);
      state.weatherFade = null;
    }
  };

  /** Whole hours the clock passed since the last step (forward only, at most one day). */
  const passedHours = (tick: number) => {
    const { day, hour } = clockAt(tick);
    const now = day * HOURS_PER_DAY + Math.floor(hour);
    const first = Math.max(state.hourSeen + 1, now - MAX_REPORTED_HOURS + 1);
    const hours: number[] = [];
    for (let absolute = first; absolute <= now; absolute++) hours.push(absolute % HOURS_PER_DAY);
    state.hourSeen = Math.max(state.hourSeen, now);
    return hours;
  };

  return {
    climate,
    /** The script conditions' season: winter on a winter-climate island, otherwise summer. */
    season: (): "summer" | "winter" => climate === "winter" ? "winter" : "summer",
    read: (tick: number): WorldEnvironmentReading => ({
      ...clockAt(tick), weather: state.weather, weatherFade: state.weatherFade
    }),
    /**
     * CIN4 presentation during a held sequence (the script clock stands still): an hour change started by the
     * sequence plays `heldTicks` of real time past `tick`, never past its end; the cycling clock does not run.
     */
    readHeld: (tick: number, heldTicks: number): WorldEnvironmentReading => {
      const transition = state.transition;
      const end = transition ? Math.max(tick, transitionEnd(transition)) : tick;
      const at = Math.min(tick + Math.max(0, heldTicks), end);
      return { ...clockAt(at), weather: state.weather, weatherFade: state.weatherFade };
    },
    save: (): SavedWorldEnvironment => ({ ...structuredClone(state), random: random.getState() }),
    /** Script `setWeather`: the state (climate rule applied) from now, the chain resumes after its dwell. */
    setWeather: (tick: number, weather: WeatherState, transitionSeconds: number | null) => {
      state.weather = weatherForClimate(weather, climate);
      state.weatherChangeTick = tick + dwellTicks(state.weather, random);
      state.weatherFade = { seconds: transitionSeconds, tick };
    },
    /**
     * CIN4: a held sequence ended inside the recorded `endCinematic`: an hour change in progress completes now,
     * because the presentation already played it during the pause (watched and skipped end alike).
     */
    settle: (tick: number) => {
      const transition = state.transition;
      if (!transition) return;
      state.anchorClock = transitionEndClock(transition);
      state.anchorTick = tick;
      state.transition = null;
    },
    /** One live script tick: settles a finished hour change, steps the chain; returns the whole hours reached. */
    step: (tick: number) => {
      settleTransition(tick);
      stepWeather(tick);
      return passedHours(tick);
    },
    /** Script `timeOfDay`: forward to `hour` over the default 3–6 s; the same hour is no change. */
    timeOfDay: (tick: number, hour: number) => {
      const current = clockAt(tick);
      const hours = forwardHours(current.hour, hour);
      state.anchorClock = clockSecondsOf(current);
      state.anchorTick = tick;
      state.transition = null;
      if (hours === 0) return;
      const ticks = secondsToTicks(hourTransitionSeconds(hours));
      state.transition = { day: current.day, from: current.hour, hours, startTick: tick, ticks };
      settleTransition(tick);
    }
  };
};

export type WorldEnvironment = ReturnType<typeof createWorldEnvironment>;
