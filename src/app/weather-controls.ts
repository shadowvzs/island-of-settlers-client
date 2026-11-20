import { createExternalStore, isShallowEqual } from "./components/ui-store";
import type { CycleSpeed, DayMode, EnvironmentController, TimePreset } from "./environment-controller";
import { settingsStorage } from "./settings/graphics-settings";
import { readWeatherState } from "./settings/sections/helpers";

/**
 * Time and weather state for Settings > Time & weather (clock, presets, day cycle, rain, snow). Rain
 * and snow exclude each other (the controller switches the other one off). React-free: the store is
 * fed at startup and read by the lazily mounted section.
 *
 * `isLocked` (ENV0, trigger design §6.11): the island's map script reads the hour or the weather, so its world
 * environment drives the sky; the viewer controls are disabled (with a reason) and their actions do nothing. Without
 * it the controls stay a pure viewer preference.
 */
export const createWeatherControls = (controller: EnvironmentController, isLocked = (): boolean => false) => {
  const store = createExternalStore(readWeatherState(controller.getControls(), isLocked()));
  /** Called with the stats refresh: keeps the clock current without per frame work. */
  const refresh = () => {
    const next = readWeatherState(controller.getControls(), isLocked());
    if (!isShallowEqual(store.getSnapshot(), next)) store.set(next);
  };
  controller.onChange(refresh);
  const unlessLocked = <Args extends unknown[]>(action: (...args: Args) => void) => (...args: Args) => {
    if (isLocked()) return;
    action(...args);
  };
  /** The Settings > Daylight choice: remembered for every island and applied at once. */
  const setMode = unlessLocked((mode: DayMode) => {
    settingsStorage.writeDayMode(mode);
    controller.setDayMode(mode);
    refresh();
  });
  const actions = {
    setCycleSpeed: unlessLocked((speed: CycleSpeed) => controller.setCycleSpeed(speed)),
    setTime: unlessLocked((preset: TimePreset) => controller.setTime(preset)),
    toggleCycle: unlessLocked(controller.toggleCycle),
    toggleRain: unlessLocked(controller.toggleRain),
    toggleSnow: unlessLocked(controller.toggleSnow)
  };
  return { actions, controller, refresh, setMode, store };
};

export type WeatherControls = ReturnType<typeof createWeatherControls>;
