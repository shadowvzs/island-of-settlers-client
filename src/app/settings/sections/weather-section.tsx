import { useLingui } from "@lingui/react";

import type { SelectOption } from "../../components/helpers";
import { Section } from "../../components/section";
import { Select } from "../../components/select";
import type { CycleSpeed, TimePreset } from "../../environment-controller";
import type { WeatherControls } from "../../weather-controls";
import { getTimePresetButtons } from "./helpers";
import { SETTINGS_MESSAGES } from "./messages";
import { useWeatherSection } from "./use-weather-section";

interface WeatherSectionViewProps {
  clock: string;
  cycleClassName?: string;
  cycleSpeed: CycleSpeed;
  cycleSpeedChoices: readonly SelectOption<CycleSpeed>[];
  locked: boolean;
  rainClassName?: string;
  snowClassName?: string;
  onCycleSpeed: (speed: CycleSpeed) => void;
  onPreset: (preset: TimePreset) => void;
  onToggleCycle: () => void;
  onToggleRain: () => void;
  onToggleSnow: () => void;
}
const WeatherSectionView = ({
  clock, cycleClassName, cycleSpeed, cycleSpeedChoices, locked, rainClassName, snowClassName, onCycleSpeed, onPreset,
  onToggleCycle, onToggleRain, onToggleSnow
}: WeatherSectionViewProps) => {
  const { i18n } = useLingui();
  return (
    <Section icon="weather" title={i18n._(SETTINGS_MESSAGES.weather.title)}>
      <div className="weather-controls">
        <span className="weather-controls__clock">{clock}</span>
        {getTimePresetButtons(i18n).map(({ label, preset }) => (
          <button disabled={locked} key={preset} type="button" onClick={() => onPreset(preset)}>{label}</button>
        ))}
        <button className={cycleClassName} disabled={locked} type="button" onClick={onToggleCycle}>
          {i18n._(SETTINGS_MESSAGES.weather.dayCycle)}
        </button>
        <button className={rainClassName} disabled={locked} type="button" onClick={onToggleRain}>
          {i18n._(SETTINGS_MESSAGES.weather.rain)}
        </button>
        <button className={snowClassName} disabled={locked} type="button" onClick={onToggleSnow}>
          {i18n._(SETTINGS_MESSAGES.weather.snow)}
        </button>
      </div>
      {!locked && (
        <Select choices={cycleSpeedChoices} label={i18n._(SETTINGS_MESSAGES.weather.cycleSpeed)} selected={cycleSpeed}
          title={i18n._(SETTINGS_MESSAGES.weather.cycleSpeedTitle)} onChange={onCycleSpeed} />
      )}
      {locked && <p className="settings-panel__hint">{i18n._(SETTINGS_MESSAGES.weather.locked)}</p>}
    </Section>
  );
};

interface WeatherSectionProps {
  weather: WeatherControls;
}
/** Clock (refreshed with the 0.5 s stats tick), time presets, day cycle and its time-lapse speed, rain and snow. */
export const WeatherSection = ({ weather }: WeatherSectionProps) =>
  <WeatherSectionView {...useWeatherSection(weather)} />;
