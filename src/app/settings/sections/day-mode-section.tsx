import type { MessageDescriptor } from "@lingui/core";
import { useLingui } from "@lingui/react";

import natureIcon from "../../../../assets/ui-icons/actions/theme.webp?url";
import sunIcon from "../../../../assets/ui-icons/mode-light.png?url";
import { Section } from "../../components/section";
import type { DayMode } from "../../environment-controller";
import type { WeatherControls } from "../../weather-controls";
import { SETTINGS_MESSAGES } from "./messages";
import { useWeatherSection } from "./use-weather-section";

const optionClassName = (active: boolean) => {
  if (active) return "settings-panel__day-option is-active";
  return "settings-panel__day-option";
};

const OPTIONS: readonly { icon: string; label: MessageDescriptor; mode: DayMode; title: MessageDescriptor }[] = [
  {
    icon: natureIcon,
    label: SETTINGS_MESSAGES.daylight.nature,
    mode: "nature",
    title: SETTINGS_MESSAGES.daylight.natureTitle
  },
  {
    icon: sunIcon,
    label: SETTINGS_MESSAGES.daylight.alwaysDay,
    mode: "sun",
    title: SETTINGS_MESSAGES.daylight.alwaysDayTitle
  }
];

interface DayModeSectionProps {
  weather: WeatherControls;
}
/**
 * Settings > Daylight: a two-option radio group choosing the natural cycle or a permanent clear day; disabled with
 * a reason where the map script controls time and weather (ENV0).
 */
export const DayModeSection = ({ weather }: DayModeSectionProps) => {
  const { i18n } = useLingui();
  const { locked, mode, onMode } = useWeatherSection(weather);
  return (
    <Section
      icon="weather"
      info={{
        label: i18n._(SETTINGS_MESSAGES.daylight.title),
        text: i18n._(SETTINGS_MESSAGES.daylight.hint)
      }}
      title={i18n._(SETTINGS_MESSAGES.daylight.title)}
    >
      <div aria-label={i18n._(SETTINGS_MESSAGES.daylight.group)} className="settings-panel__day-mode" role="radiogroup">
        {OPTIONS.map(option => (
          <label
            className={optionClassName(mode === option.mode)}
            key={option.mode}
            title={i18n._(option.title)}
          >
            <input
              checked={mode === option.mode}
              disabled={locked}
              name="day-mode"
              type="radio"
              value={option.mode}
              onChange={() => onMode(option.mode)}
            />
            <img alt="" draggable={false} height={42} src={option.icon} width={42} />
            <span>{i18n._(option.label)}</span>
          </label>
        ))}
      </div>
      {locked && <p className="settings-panel__hint">{i18n._(SETTINGS_MESSAGES.weather.locked)}</p>}
    </Section>
  );
};
