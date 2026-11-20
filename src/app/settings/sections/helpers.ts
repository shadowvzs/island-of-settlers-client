import type { I18n, MessageDescriptor } from "@lingui/core";

import {
  CHARACTER_DETAIL_CHOICES,
  type CharacterDetailChoice
} from "../../../render-common/character-detail";
import { COLOR_TONES, type ColorTone } from "../../../render-common/color-output";
import {
  AMBIENT_OCCLUSIONS,
  type AmbientOcclusion,
  BLOOM_QUALITIES,
  type BloomQuality,
  LAWN_DEPTHS,
  type LawnDepth,
  QUALITY_LEVELS,
  type QualityLevel,
  type SceneTarget,
  WATER_REFLECTIONS,
  type WaterReflections
} from "../../../render-common/quality";
import {
  AUTO_EXPOSURE_MAX_PERCENT,
  canChooseAmbientOcclusion,
  canChooseAutoExposure,
  canChooseQualityToggle,
  canChooseSunRays,
  canChooseWaterReflections,
  getAutoExposureChoice,
  getSceneTargetChoices,
  getSunRaysChoice,
  QUALITY_TOGGLES,
  type QualityOverrides,
  type QualityToggle,
  resolveQualityPreset,
  SUN_RAYS_MAX_PERCENT
} from "../../../render-common/quality-overrides";
import type { ResolutionMode } from "../../../render-common/resolution";
import { translateMessage } from "../../../shared/i18n/translate";
import type { SelectOption } from "../../components/helpers";
import {
  CYCLE_SPEEDS, type CycleSpeed, type DayMode, type EnvironmentControls, type TimePreset
} from "../../environment-controller";
import { SOUND_LAYERS, type SoundLayer } from "../sound-settings";
import { SETTINGS_MESSAGES } from "./messages";

const DETAIL_LEVEL_MESSAGES: Record<QualityLevel, MessageDescriptor> =
  SETTINGS_MESSAGES.graphics.detailLevel;
const CHARACTER_DETAIL_MESSAGES: Record<CharacterDetailChoice, MessageDescriptor> =
  SETTINGS_MESSAGES.graphics.characterDetailChoice;
const RESOLUTION_MESSAGES: Record<ResolutionMode, MessageDescriptor> = {
  auto: SETTINGS_MESSAGES.graphics.resolutionChoice.auto,
  balanced: SETTINGS_MESSAGES.graphics.resolutionChoice.balanced,
  fast: SETTINGS_MESSAGES.graphics.resolutionChoice.fast,
  sharp: SETTINGS_MESSAGES.graphics.resolutionChoice.sharp
};
const TONE_MESSAGES: Record<ColorTone, MessageDescriptor> = SETTINGS_MESSAGES.graphics.toneChoice;
const AMBIENT_OCCLUSION_MESSAGES: Record<AmbientOcclusion, MessageDescriptor> =
  SETTINGS_MESSAGES.graphics.ambientOcclusionChoice;
const BLOOM_MESSAGES: Record<BloomQuality, MessageDescriptor> =
  SETTINGS_MESSAGES.graphics.bloomChoice;
const WATER_REFLECTION_MESSAGES: Record<WaterReflections, MessageDescriptor> =
  SETTINGS_MESSAGES.graphics.waterReflectionsChoice;
const LAWN_DEPTH_MESSAGES: Record<LawnDepth, MessageDescriptor> =
  SETTINGS_MESSAGES.graphics.lawnDepthChoice;
const TIME_PRESET_MESSAGES: Record<TimePreset, MessageDescriptor> = {
  dawn: SETTINGS_MESSAGES.weather.preset.dawn,
  day: SETTINGS_MESSAGES.weather.preset.day,
  dusk: SETTINGS_MESSAGES.weather.preset.dusk,
  night: SETTINGS_MESSAGES.weather.preset.night
};
const SOUND_LAYER_MESSAGES: Record<SoundLayer, MessageDescriptor> = {
  rain: SETTINGS_MESSAGES.sound.layer.rain,
  trees: SETTINGS_MESSAGES.sound.layer.trees,
  water: SETTINGS_MESSAGES.sound.layer.water,
  wildlife: SETTINGS_MESSAGES.sound.layer.wildlife
};

export const getDetailHint = (i18n?: I18n) =>
  translateMessage(i18n, SETTINGS_MESSAGES.graphics.detailHelp);

const RESOLUTION_ORDER: readonly ResolutionMode[] = ["auto", "sharp", "balanced", "fast"];

export const getResolutionOptions = (i18n?: I18n): readonly SelectOption<ResolutionMode>[] =>
  RESOLUTION_ORDER.map(value => ({
    label: translateMessage(i18n, RESOLUTION_MESSAGES[value]),
    value
  }));

export const getToneOptions = (i18n?: I18n): readonly SelectOption<ColorTone>[] =>
  COLOR_TONES.map(value => ({ label: translateMessage(i18n, TONE_MESSAGES[value]), value }));

/** Character detail slider labels, cheapest first ("Auto" is the first stop). */
export const getCharacterDetailLevels = (i18n?: I18n): readonly string[] =>
  CHARACTER_DETAIL_CHOICES.map(choice =>
    translateMessage(i18n, CHARACTER_DETAIL_MESSAGES[choice])
  );

/** A Character detail choice waiting for its ✓ tick; the renderer keeps the applied one meanwhile. */
export interface PendingCharacterDetail {
  applied: CharacterDetailChoice;
  pending: CharacterDetailChoice;
}

export const createPendingCharacterDetail = (
  applied: CharacterDetailChoice
): PendingCharacterDetail => ({ applied, pending: applied });

/** Moving the slider only marks a pending choice; nothing is applied or stored yet. */
export const selectCharacterDetail = (
  state: PendingCharacterDetail,
  choice: CharacterDetailChoice
): PendingCharacterDetail => ({ applied: state.applied, pending: choice });

/** The ✓ is enabled only while the pending choice differs from the applied one. */
export const canApplyCharacterDetail = (state: PendingCharacterDetail) =>
  state.pending !== state.applied;

/** Applies the pending choice once (live, no reload) and marks it as the applied one. */
export const applyPendingCharacterDetail = (
  state: PendingCharacterDetail,
  commit: (choice: CharacterDetailChoice) => void
): PendingCharacterDetail => {
  commit(state.pending);
  return { applied: state.pending, pending: state.pending };
};

/** Moving the Detail slider discards the pending Character detail choice, as it does the overrides. */
export const resetCharacterDetail = (
  state: PendingCharacterDetail
): PendingCharacterDetail => ({ applied: state.applied, pending: state.applied });

/** Detail slider levels; the first run's recommendation is marked. */
export const getDetailLevels = (recommended: QualityLevel | null, i18n?: I18n) =>
  QUALITY_LEVELS.map(level => {
    const label = translateMessage(i18n, DETAIL_LEVEL_MESSAGES[level]);
    if (level !== recommended) return label;
    return translateMessage(i18n, SETTINGS_MESSAGES.graphics.detailRecommended, { level: label });
  });

export const getTimePresetButtons = (i18n?: I18n): readonly { label: string; preset: TimePreset }[] =>
  (Object.keys(TIME_PRESET_MESSAGES) as TimePreset[]).map(preset => ({
    label: translateMessage(i18n, TIME_PRESET_MESSAGES[preset]),
    preset
  }));

/** Game hour (0..24) as a HH:MM clock. */
export const formatHour = (hour: number) => {
  const hours = Math.floor(hour);
  const minutes = Math.floor((hour - hours) * 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

/** What the Time & weather section shows: the clock text and the toggles' states. */
export interface WeatherState {
  clock: string;
  cycleSpeed: CycleSpeed;
  cycling: boolean;
  /** The map script controls time and weather (ENV0): the controls are disabled with a reason. */
  locked: boolean;
  mode: DayMode;
  raining: boolean;
  snowing: boolean;
}

export const readWeatherState = (
  { cycleSpeed, cycling, hour, mode, raining, snowing }: EnvironmentControls, locked = false
): WeatherState => ({ clock: formatHour(hour), cycleSpeed, cycling, locked, mode, raining, snowing });

/** The time-lapse choices of the day cycle ("1×" … "240×"); numbers, so they need no translation. */
export const getCycleSpeedChoices = (): readonly SelectOption<CycleSpeed>[] =>
  CYCLE_SPEEDS.map(speed => ({ label: `${speed}×`, value: speed }));

/** One environment layer toggle of the Sound section. */
export interface SoundLayerRow {
  checked: boolean;
  label: string;
  layer: SoundLayer;
}

export const getSoundLayerRows = (layersOff: ReadonlySet<SoundLayer>, i18n?: I18n): SoundLayerRow[] =>
  SOUND_LAYERS.map(layer => ({
    checked: !layersOff.has(layer),
    label: translateMessage(i18n, SOUND_LAYER_MESSAGES[layer]),
    layer
  }));

/** Ambient occlusion select: Off, Soft and Strong on Medium and High; no choice (empty) on Low/Minimal. */
export const getAmbientOcclusionOptions = (
  level: QualityLevel,
  i18n?: I18n
): readonly SelectOption<AmbientOcclusion>[] => {
  if (!canChooseAmbientOcclusion(level)) return [];
  return AMBIENT_OCCLUSIONS.map(value => ({
    label: translateMessage(i18n, AMBIENT_OCCLUSION_MESSAGES[value]),
    value
  }));
};

/** Water reflections select: Off and On on Medium and High; no choice (empty) on Low/Minimal. */
export const getWaterReflectionOptions = (
  level: QualityLevel,
  i18n?: I18n
): readonly SelectOption<WaterReflections>[] => {
  if (!canChooseWaterReflections(level)) return [];
  return WATER_REFLECTIONS.map(value => ({
    label: translateMessage(i18n, WATER_REFLECTION_MESSAGES[value]),
    value
  }));
};

/** Bloom select: Off, Soft and Full on every level. */
export const getBloomOptions = (i18n?: I18n): readonly SelectOption<BloomQuality>[] =>
  BLOOM_QUALITIES.map(value => ({
    label: translateMessage(i18n, BLOOM_MESSAGES[value]),
    value
  }));

/** Lawn depth select: Off, Normal and Strong on every level. */
export const getLawnDepthOptions = (i18n?: I18n): readonly SelectOption<LawnDepth>[] =>
  LAWN_DEPTHS.map(value => ({
    label: translateMessage(i18n, LAWN_DEPTH_MESSAGES[value]),
    value
  }));

/** Colour precision select: the level's choices (Off only where the level draws without a target). */
export const getColourPrecisionOptions = (
  level: QualityLevel,
  i18n?: I18n
): readonly SelectOption<SceneTarget>[] =>
  getSceneTargetChoices(level).map(value => ({
    label: translateMessage(i18n, SETTINGS_MESSAGES.graphics.colourPrecisionChoice[value]),
    value
  }));

/** One visual feature checkbox of the Graphics section (disabled with its reason where not offered). */
export interface QualityToggleRow {
  checked: boolean;
  disabled: boolean;
  label: string;
  title: string;
  toggle: QualityToggle;
}

/** Why a level does not offer a toggle; only the level-limited toggles have one. */
const TOGGLE_BLOCKERS: Partial<Record<QualityToggle, MessageDescriptor>> = {
  iceFloes: SETTINGS_MESSAGES.graphics.iceFloesNeedsLevel
};

const getToggleTitle = (toggle: QualityToggle, offered: boolean, i18n?: I18n) => {
  const cost = translateMessage(i18n, SETTINGS_MESSAGES.graphics.toggles[toggle].cost);
  const blocker = TOGGLE_BLOCKERS[toggle];
  if (offered || !blocker) return cost;
  return `${translateMessage(i18n, blocker)} ${cost}`;
};

export const getQualityToggleRows = (
  level: QualityLevel,
  states: Readonly<Record<QualityToggle, boolean>>,
  i18n?: I18n
): QualityToggleRow[] =>
  QUALITY_TOGGLES.map(toggle => {
    const offered = canChooseQualityToggle(level, toggle);
    return {
      checked: offered && states[toggle],
      disabled: !offered,
      label: translateMessage(i18n, SETTINGS_MESSAGES.graphics.toggles[toggle].label),
      title: getToggleTitle(toggle, offered, i18n),
      toggle
    };
  });

/** A strength slider of the visual features: its percent, range and tooltip (with the reason when disabled). */
export interface StrengthSlider {
  disabled: boolean;
  label: string;
  maxPercent: number;
  percent: number;
  title: string;
}

interface StrengthSliderSource {
  blocker: MessageDescriptor | null;
  hint: MessageDescriptor;
  label: MessageDescriptor;
  maxPercent: number;
  percent: number;
}

/** A blocked slider shows 0 % and its reason before the hint. */
const createStrengthSlider = (
  { blocker, hint, label, maxPercent, percent }: StrengthSliderSource,
  i18n?: I18n
): StrengthSlider => {
  const name = translateMessage(i18n, label);
  const description = translateMessage(i18n, hint);
  if (blocker) {
    const title = `${name} — ${translateMessage(i18n, blocker)} ${description}`;
    return { disabled: true, label: name, maxPercent, percent: 0, title };
  }
  return { disabled: false, label: name, maxPercent, percent, title: `${name} — ${description}` };
};

/** The reason the level cannot run the sun shafts, or null when it can. */
const sunRaysBlocker = (level: QualityLevel, overrides: QualityOverrides): MessageDescriptor | null => {
  if (!canChooseSunRays(level)) return SETTINGS_MESSAGES.graphics.sunRaysNeedsHigh;
  if (!resolveQualityPreset(level, overrides).sunShadows) return SETTINGS_MESSAGES.graphics.sunRaysNeedsShadows;
  return null;
};

/** The Sun rays slider (0..200 %): disabled with its reason below High and without sun shadows. */
export const getSunRaysSlider = (level: QualityLevel, overrides: QualityOverrides, i18n?: I18n) =>
  createStrengthSlider({
    blocker: sunRaysBlocker(level, overrides),
    hint: SETTINGS_MESSAGES.graphics.sunRaysHint,
    label: SETTINGS_MESSAGES.graphics.sunRays,
    maxPercent: SUN_RAYS_MAX_PERCENT,
    percent: getSunRaysChoice(level, overrides)
  }, i18n);

/** The Eye adaptation slider (0..100 %): disabled with its reason where R11c does not run. */
export const getAutoExposureSlider = (level: QualityLevel, overrides: QualityOverrides, i18n?: I18n) =>
  createStrengthSlider({
    blocker: canChooseAutoExposure(level) ? null : SETTINGS_MESSAGES.graphics.autoExposureNeedsLevel,
    hint: SETTINGS_MESSAGES.graphics.autoExposureHint,
    label: SETTINGS_MESSAGES.graphics.autoExposure,
    maxPercent: AUTO_EXPOSURE_MAX_PERCENT,
    percent: getAutoExposureChoice(level, overrides)
  }, i18n);

/** Collapsed-header summary of the visual features: "{on} of {total} on". */
export const getToggleSummary = (rows: readonly QualityToggleRow[], i18n?: I18n) =>
  translateMessage(i18n, SETTINGS_MESSAGES.graphics.togglesSummary, {
    on: rows.filter(row => row.checked).length,
    total: rows.length
  });
