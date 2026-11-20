import { useLingui } from "@lingui/react";

import type { ColorTone } from "../../../render-common/color-output";
import type {
  AmbientOcclusion,
  BloomQuality,
  LawnDepth,
  SceneTarget,
  WaterReflections
} from "../../../render-common/quality";
import type { QualityToggle } from "../../../render-common/quality-overrides";
import type { ResolutionMode } from "../../../render-common/resolution";
import { ApplyRow } from "../../components/apply-row";
import { Checkbox } from "../../components/checkbox";
import { CollapsibleSection } from "../../components/collapsible-section";
import { fromPercent, type SelectOption } from "../../components/helpers";
import { Section } from "../../components/section";
import { Select } from "../../components/select";
import { LevelSlider, Slider } from "../../components/slider";
import { getDetailHint, getResolutionOptions, type QualityToggleRow, type StrengthSlider } from "./helpers";
import { SETTINGS_MESSAGES } from "./messages";
import { type GraphicsSettingsOptions, useGraphicsSettings } from "./use-graphics-settings";

interface GraphicsSectionViewProps {
  ambientOcclusion: AmbientOcclusion;
  ambientOcclusionOptions: readonly SelectOption<AmbientOcclusion>[];
  autoExposure: StrengthSlider;
  bloom: BloomQuality;
  bloomOptions: readonly SelectOption<BloomQuality>[];
  canApplyCharacterDetail: boolean;
  canApplyDetail: boolean;
  canApplyResolution: boolean;
  characterDetailLevel: number;
  characterDetailLevels: readonly string[];
  colourPrecision: SceneTarget;
  colourPrecisionOptions: readonly SelectOption<SceneTarget>[];
  detailLevel: number;
  detailLevels: readonly string[];
  highlights: number;
  lawnDepth: LawnDepth;
  lawnDepthOptions: readonly SelectOption<LawnDepth>[];
  resolution: ResolutionMode;
  sunRays: StrengthSlider;
  toggleRows: readonly QualityToggleRow[];
  toggleSummary: string;
  tone: ColorTone;
  toneOptions: readonly SelectOption<ColorTone>[];
  waterReflectionOptions: readonly SelectOption<WaterReflections>[];
  waterReflections: WaterReflections;
  onAmbientOcclusionChange: (ambientOcclusion: AmbientOcclusion) => void;
  onApplyCharacterDetail: () => void;
  onApplyDetail: () => void;
  onApplyResolution: () => void;
  onAutoExposureInput: (strength: number) => void;
  onBloomChange: (bloom: BloomQuality) => void;
  onCharacterDetailInput: (level: number) => void;
  onColourPrecisionChange: (target: SceneTarget) => void;
  onDetailInput: (level: number) => void;
  onHighlightsInput: (strength: number) => void;
  onLawnDepthChange: (depth: LawnDepth) => void;
  onResolutionChange: (mode: ResolutionMode) => void;
  onSunRaysInput: (strength: number) => void;
  onToggleChange: (toggle: QualityToggle, checked: boolean) => void;
  onToneChange: (tone: ColorTone) => void;
  onWaterReflectionsChange: (waterReflections: WaterReflections) => void;
}
interface QualityToggleListProps {
  ambientOcclusion: AmbientOcclusion;
  ambientOcclusionOptions: readonly SelectOption<AmbientOcclusion>[];
  autoExposure: StrengthSlider;
  bloom: BloomQuality;
  bloomOptions: readonly SelectOption<BloomQuality>[];
  colourPrecision: SceneTarget;
  colourPrecisionOptions: readonly SelectOption<SceneTarget>[];
  lawnDepth: LawnDepth;
  lawnDepthOptions: readonly SelectOption<LawnDepth>[];
  rows: readonly QualityToggleRow[];
  sunRays: StrengthSlider;
  waterReflectionOptions: readonly SelectOption<WaterReflections>[];
  waterReflections: WaterReflections;
  onAmbientOcclusionChange: (ambientOcclusion: AmbientOcclusion) => void;
  onAutoExposureInput: (strength: number) => void;
  onBloomChange: (bloom: BloomQuality) => void;
  onColourPrecisionChange: (target: SceneTarget) => void;
  onLawnDepthChange: (depth: LawnDepth) => void;
  onSunRaysInput: (strength: number) => void;
  onToggleChange: (toggle: QualityToggle, checked: boolean) => void;
  onWaterReflectionsChange: (waterReflections: WaterReflections) => void;
}
interface LevelOnlySelectProps<T extends string> {
  choices: readonly SelectOption<T>[];
  hint: string;
  label: string;
  selected: T;
  onChange: (value: T) => void;
}

/** A choice only some Detail levels offer (Medium and High): no options, no select. */
const LevelOnlySelect = <T extends string>({ choices, hint, label, selected, onChange }: LevelOnlySelectProps<T>) => {
  if (choices.length === 0) return null;
  return <Select choices={choices} info={{ label, text: hint }} label={label} selected={selected} onChange={onChange} />;
};

interface StrengthSliderFieldProps {
  slider: StrengthSlider;
  onInput: (strength: number) => void;
}

/** Step of the strength sliders: coarse enough to land on 100 % again in the half-width column. */
const STRENGTH_STEP_PERCENT = 5;

/** A visual-feature strength slider on the shared percent slider; the tooltip carries hint and reason. */
const StrengthSliderField = ({ slider, onInput }: StrengthSliderFieldProps) => (
  <Slider
    disabled={slider.disabled}
    label={slider.label}
    maxPercent={slider.maxPercent}
    stepPercent={STRENGTH_STEP_PERCENT}
    title={slider.title}
    value={fromPercent(slider.percent)}
    onInput={onInput}
  />
);

const QualityToggleList = ({
  ambientOcclusion, ambientOcclusionOptions, autoExposure, bloom, bloomOptions, colourPrecision,
  colourPrecisionOptions, lawnDepth, lawnDepthOptions, rows, sunRays, waterReflectionOptions, waterReflections,
  onAmbientOcclusionChange, onAutoExposureInput, onBloomChange, onColourPrecisionChange, onLawnDepthChange,
  onSunRaysInput, onToggleChange, onWaterReflectionsChange
}: QualityToggleListProps) => {
  const { i18n } = useLingui();
  return (
    <>
      <div className="settings-panel__toggle-grid">
        {rows.map(({ checked, disabled, label, title, toggle }) => (
          <Checkbox
            checked={checked}
            disabled={disabled}
            key={toggle}
            label={label}
            title={`${label} — ${title}`}
            onChange={value => onToggleChange(toggle, value)}
          />
        ))}
        <StrengthSliderField slider={sunRays} onInput={onSunRaysInput} />
        <StrengthSliderField slider={autoExposure} onInput={onAutoExposureInput} />
        <Select
          choices={colourPrecisionOptions}
          info={{
            label: i18n._(SETTINGS_MESSAGES.graphics.colourPrecision),
            text: i18n._(SETTINGS_MESSAGES.graphics.colourPrecisionCost)
          }}
          label={i18n._(SETTINGS_MESSAGES.graphics.colourPrecision)}
          selected={colourPrecision}
          onChange={onColourPrecisionChange}
        />
        <Select
          choices={lawnDepthOptions}
          info={{
            label: i18n._(SETTINGS_MESSAGES.graphics.lawnDepth),
            text: i18n._(SETTINGS_MESSAGES.graphics.lawnDepthCost)
          }}
          label={i18n._(SETTINGS_MESSAGES.graphics.lawnDepth)}
          selected={lawnDepth}
          onChange={onLawnDepthChange}
        />
        <Select
          choices={bloomOptions}
          info={{
            label: i18n._(SETTINGS_MESSAGES.graphics.bloom),
            text: i18n._(SETTINGS_MESSAGES.graphics.bloomCost)
          }}
          label={i18n._(SETTINGS_MESSAGES.graphics.bloom)}
          selected={bloom}
          onChange={onBloomChange}
        />
        <LevelOnlySelect
          choices={ambientOcclusionOptions}
          hint={i18n._(SETTINGS_MESSAGES.graphics.ambientOcclusionCost)}
          label={i18n._(SETTINGS_MESSAGES.graphics.ambientOcclusion)}
          selected={ambientOcclusion}
          onChange={onAmbientOcclusionChange}
        />
        <LevelOnlySelect
          choices={waterReflectionOptions}
          hint={i18n._(SETTINGS_MESSAGES.graphics.waterReflectionsCost)}
          label={i18n._(SETTINGS_MESSAGES.graphics.waterReflections)}
          selected={waterReflections}
          onChange={onWaterReflectionsChange}
        />
      </div>
    </>
  );
};

const GraphicsSectionView = ({
  ambientOcclusion, ambientOcclusionOptions, autoExposure, bloom, bloomOptions, canApplyCharacterDetail,
  canApplyDetail, canApplyResolution, characterDetailLevel, characterDetailLevels, colourPrecision,
  colourPrecisionOptions, detailLevel, detailLevels, highlights, lawnDepth, lawnDepthOptions, resolution, sunRays,
  toggleRows, toggleSummary, tone, toneOptions, waterReflectionOptions, waterReflections,
  onAmbientOcclusionChange, onApplyCharacterDetail, onApplyDetail, onApplyResolution, onAutoExposureInput,
  onBloomChange, onCharacterDetailInput, onColourPrecisionChange, onDetailInput, onHighlightsInput,
  onLawnDepthChange, onResolutionChange, onSunRaysInput, onToggleChange, onToneChange, onWaterReflectionsChange
}: GraphicsSectionViewProps) => {
  const { i18n } = useLingui();
  return (
    <Section icon="settings" title={i18n._(SETTINGS_MESSAGES.graphics.title)}>
      <ApplyRow
        canApply={canApplyDetail}
        label={i18n._(SETTINGS_MESSAGES.graphics.applyDetail)}
        onApply={onApplyDetail}
      >
        <LevelSlider
          info={{ label: i18n._(SETTINGS_MESSAGES.graphics.detail), text: getDetailHint(i18n) }}
          label={i18n._(SETTINGS_MESSAGES.graphics.detail)}
          level={detailLevel}
          levels={detailLevels}
          onInput={onDetailInput}
        />
      </ApplyRow>
      <ApplyRow
        canApply={canApplyCharacterDetail}
        label={i18n._(SETTINGS_MESSAGES.graphics.applyCharacterDetail)}
        onApply={onApplyCharacterDetail}
      >
        <LevelSlider
          info={{
            label: i18n._(SETTINGS_MESSAGES.graphics.characterDetail),
            text: i18n._(SETTINGS_MESSAGES.graphics.characterDetailHint)
          }}
          label={i18n._(SETTINGS_MESSAGES.graphics.characterDetail)}
          level={characterDetailLevel}
          levels={characterDetailLevels}
          onInput={onCharacterDetailInput}
        />
      </ApplyRow>
      <CollapsibleSection
        id="graphics.visualFeatures"
        info={{
          label: i18n._(SETTINGS_MESSAGES.graphics.togglesTitle),
          text: i18n._(SETTINGS_MESSAGES.graphics.toggleHint)
        }}
        summary={toggleSummary}
        title={i18n._(SETTINGS_MESSAGES.graphics.togglesTitle)}
      >
        <QualityToggleList
          ambientOcclusion={ambientOcclusion}
          ambientOcclusionOptions={ambientOcclusionOptions}
          autoExposure={autoExposure}
          bloom={bloom}
          bloomOptions={bloomOptions}
          colourPrecision={colourPrecision}
          colourPrecisionOptions={colourPrecisionOptions}
          lawnDepth={lawnDepth}
          lawnDepthOptions={lawnDepthOptions}
          rows={toggleRows}
          sunRays={sunRays}
          waterReflectionOptions={waterReflectionOptions}
          waterReflections={waterReflections}
          onAmbientOcclusionChange={onAmbientOcclusionChange}
          onAutoExposureInput={onAutoExposureInput}
          onBloomChange={onBloomChange}
          onColourPrecisionChange={onColourPrecisionChange}
          onLawnDepthChange={onLawnDepthChange}
          onSunRaysInput={onSunRaysInput}
          onToggleChange={onToggleChange}
          onWaterReflectionsChange={onWaterReflectionsChange}
        />
      </CollapsibleSection>
      <ApplyRow
        canApply={canApplyResolution}
        centered
        label={i18n._(SETTINGS_MESSAGES.graphics.applyResolution)}
        onApply={onApplyResolution}
      >
        <Select
          choices={getResolutionOptions(i18n)}
          info={{
            label: i18n._(SETTINGS_MESSAGES.graphics.resolution),
            text: i18n._(SETTINGS_MESSAGES.graphics.resolutionHint)
          }}
          label={i18n._(SETTINGS_MESSAGES.graphics.resolution)}
          selected={resolution}
          onChange={onResolutionChange}
        />
      </ApplyRow>
      <Select
        choices={toneOptions}
        info={{
          label: i18n._(SETTINGS_MESSAGES.graphics.tone),
          text: i18n._(SETTINGS_MESSAGES.graphics.toneHint)
        }}
        label={i18n._(SETTINGS_MESSAGES.graphics.tone)}
        selected={tone}
        onChange={onToneChange}
      />
      <Slider
        info={{
          label: i18n._(SETTINGS_MESSAGES.graphics.highlights),
          text: i18n._(SETTINGS_MESSAGES.graphics.highlightsHint)
        }}
        label={i18n._(SETTINGS_MESSAGES.graphics.highlights)}
        value={highlights}
        onInput={onHighlightsInput}
      />
    </Section>
  );
};

/**
 * Detail and Character detail sliders plus the resolution select (each applies on its ✓ tick);
 * Tone and Highlights / glare apply live.
 */
export const GraphicsSection = (props: GraphicsSettingsOptions) =>
  <GraphicsSectionView {...useGraphicsSettings(props)} />;
