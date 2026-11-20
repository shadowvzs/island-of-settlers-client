import { useExternalStore } from "../../components/external-store";
import { getActiveClassName } from "../../components/helpers";
import type { WeatherControls } from "../../weather-controls";
import { getCycleSpeedChoices } from "./helpers";

export const useWeatherSection = ({ actions, setMode, store }: WeatherControls) => {
  const { clock, cycleSpeed, cycling, locked, mode, raining, snowing } = useExternalStore(store);
  return {
    clock,
    cycleClassName: getActiveClassName(cycling),
    cycleSpeed,
    cycleSpeedChoices: getCycleSpeedChoices(),
    locked,
    mode,
    rainClassName: getActiveClassName(raining),
    snowClassName: getActiveClassName(snowing),
    onMode: setMode,
    onCycleSpeed: actions.setCycleSpeed,
    onPreset: actions.setTime,
    onToggleCycle: actions.toggleCycle,
    onToggleRain: actions.toggleRain,
    onToggleSnow: actions.toggleSnow
  };
};
