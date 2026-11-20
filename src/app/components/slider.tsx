import { formatLevelCaption, formatPercentCaption, fromPercent, toPercent } from "./helpers";
import { type InfoContent, InlineInfo } from "./info-hint";

interface SliderProps {
  disabled?: boolean;
  info?: InfoContent;
  label: string;
  /** Right end in percent (default 100); strength sliders may go beyond, e.g. 200. */
  maxPercent?: number;
  stepPercent?: number;
  title?: string;
  value: number;
  onInput: (value: number) => void;
}
/**
 * Labelled percent slider (volumes, strengths), 0..100 % unless `maxPercent` says otherwise:
 * reports the ratio (0..1 at 100 %) on every move so the caller applies it live.
 */
export const Slider = ({
  disabled, info, label, maxPercent = 100, stepPercent = 1, title, value, onInput
}: SliderProps) => {
  const percent = toPercent(value);
  const slider = (
    <label className="settings-panel__slider" title={title}>
      <span>{formatPercentCaption(label, percent)}</span>
      <input
        disabled={disabled}
        max={maxPercent}
        min="0"
        step={stepPercent}
        type="range"
        value={percent}
        onChange={event => onInput(fromPercent(Number(event.target.value)))}
      />
    </label>
  );
  if (!info) return slider;
  return (
    <div className="settings-panel__control-row">
      {slider}
      <InlineInfo info={info} />
    </div>
  );
};

interface LevelSliderProps {
  info?: InfoContent;
  label: string;
  level: number;
  levels: readonly string[];
  onInput: (level: number) => void;
}
/** Labelled slider over named levels; the caption `Name: level` is its accessible name. */
export const LevelSlider = ({ info, label, level, levels, onInput }: LevelSliderProps) => {
  const slider = (
    <label className="settings-panel__slider">
      <span>{formatLevelCaption(label, levels, level)}</span>
      <input
        max={levels.length - 1}
        min="0"
        step="1"
        type="range"
        value={level}
        onChange={event => onInput(Number(event.target.value))}
      />
    </label>
  );
  if (!info) return slider;
  return (
    <div className="settings-panel__control-row">
      {slider}
      <InlineInfo info={info} />
    </div>
  );
};
