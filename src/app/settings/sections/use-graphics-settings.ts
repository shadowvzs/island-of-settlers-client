import { useLingui } from "@lingui/react";
import { useState } from "react";

import {
  CHARACTER_DETAIL_CHOICES,
  type CharacterDetailChoice
} from "../../../render-common/character-detail";
import type { ColorTone } from "../../../render-common/color-output";
import {
  type AmbientOcclusion,
  type BloomQuality,
  type LawnDepth,
  QUALITY_LEVELS,
  type QualityLevel,
  type SceneTarget,
  type WaterReflections
} from "../../../render-common/quality";
import {
  areQualityOverridesEqual,
  getAmbientOcclusionChoice,
  getBloomChoice,
  getLawnDepthChoice,
  getQualityToggleStates,
  getSceneTargetChoice,
  getWaterReflectionsChoice,
  normalizeQualityOverrides,
  type QualityToggle,
  setAmbientOcclusionChoice,
  setAutoExposureChoice,
  setBloomChoice,
  setLawnDepthChoice,
  setQualityToggle,
  setSceneTargetChoice,
  setSunRaysChoice,
  setWaterReflectionsChoice
} from "../../../render-common/quality-overrides";
import type { ResolutionMode } from "../../../render-common/resolution";
import { toPercent } from "../../components/helpers";
import { useSetting } from "../../components/use-setting";
import { type ApplyDetail, reloadWithDetail, settingsStorage } from "../graphics-settings";
import {
  applyPendingCharacterDetail,
  canApplyCharacterDetail,
  createPendingCharacterDetail,
  getAmbientOcclusionOptions,
  getAutoExposureSlider,
  getBloomOptions,
  getCharacterDetailLevels,
  getColourPrecisionOptions,
  getDetailLevels,
  getLawnDepthOptions,
  getQualityToggleRows,
  getSunRaysSlider,
  getToggleSummary,
  getToneOptions,
  getWaterReflectionOptions,
  resetCharacterDetail,
  selectCharacterDetail
} from "./helpers";

/** A choice that only applies (and reloads the game) on its tick; a slip of the thumb changes nothing. */
const usePendingChoice = <T>(applied: T) => {
  const [current, setCurrent] = useState(applied);
  const [pending, setPending] = useState(applied);
  return {
    apply: (commit: (value: T) => void) => {
      commit(pending);
      setCurrent(pending);
    },
    canApply: pending !== current,
    pending,
    setPending
  };
};

/**
 * The Detail level and the visual features (checkboxes, choices, strength sliders) share one
 * pending choice and one ✓ tick. Moving the Detail slider resets them to that level's defaults;
 * changing one records only the difference from the defaults. The strength sliders report a ratio
 * (1 = 100 %) and are stored in percent.
 */
const usePendingGraphics = (detail: QualityLevel) => {
  const [applied, setApplied] = useState(() => ({
    detail,
    overrides: normalizeQualityOverrides(detail, settingsStorage.readQualityOverrides())
  }));
  const [pending, setPending] = useState(applied);
  return {
    apply: (commit: ApplyDetail) => {
      commit(pending.detail, pending.overrides);
      setApplied(pending);
    },
    canApply: pending.detail !== applied.detail ||
      !areQualityOverridesEqual(pending.overrides, applied.overrides),
    pending,
    selectDetail: (level: QualityLevel) => setPending({ detail: level, overrides: {} }),
    setAmbientOcclusion: (ambientOcclusion: AmbientOcclusion) => setPending(current => ({
      ...current,
      overrides: setAmbientOcclusionChoice(current.detail, current.overrides, ambientOcclusion)
    })),
    setAutoExposure: (strength: number) => setPending(current => ({
      ...current,
      overrides: setAutoExposureChoice(current.detail, current.overrides, toPercent(strength))
    })),
    setBloom: (bloom: BloomQuality) => setPending(current => ({
      ...current,
      overrides: setBloomChoice(current.detail, current.overrides, bloom)
    })),
    setLawnDepth: (depth: LawnDepth) => setPending(current => ({
      ...current,
      overrides: setLawnDepthChoice(current.detail, current.overrides, depth)
    })),
    setSceneTarget: (target: SceneTarget) => setPending(current => ({
      ...current,
      overrides: setSceneTargetChoice(current.detail, current.overrides, target)
    })),
    setSunRays: (strength: number) => setPending(current => ({
      ...current,
      overrides: setSunRaysChoice(current.detail, current.overrides, toPercent(strength))
    })),
    setToggle: (toggle: QualityToggle, checked: boolean) => setPending(current => ({
      ...current,
      overrides: setQualityToggle(current.detail, current.overrides, toggle, checked)
    })),
    setWaterReflections: (waterReflections: WaterReflections) => setPending(current => ({
      ...current,
      overrides: setWaterReflectionsChoice(current.detail, current.overrides, waterReflections)
    }))
  };
};

export interface GraphicsSettingsOptions {
  applyCharacterDetail?: (choice: CharacterDetailChoice) => void;
  applyDetail?: ApplyDetail;
  applyResolution: (mode: ResolutionMode) => void;
  characterDetail: CharacterDetailChoice;
  detail: QualityLevel;
  highlights: number;
  recommended: QualityLevel | null;
  resolution: ResolutionMode;
  tone: ColorTone;
  setHighlights: (strength: number) => void;
  setTone: (tone: ColorTone) => void;
}

/** Tone applies live (uniform values only), so it needs no ✓ tick. */
const useLiveTone = (applied: ColorTone, setTone: (tone: ColorTone) => void) => {
  const [tone, setCurrent] = useState(applied);
  return {
    onToneChange: (next: ColorTone) => {
      setCurrent(next);
      setTone(next);
    },
    tone
  };
};

/** Character detail waits for its ✓ tick; applying is still live (next crowd frame, no reload). */
const usePendingCharacterDetail = (
  applied: CharacterDetailChoice,
  apply: ((choice: CharacterDetailChoice) => void) | undefined
) => {
  const [choice, setChoice] = useState(() => createPendingCharacterDetail(applied));
  const commit = apply ?? settingsStorage.writeCharacterDetail;
  return {
    canApplyCharacterDetail: canApplyCharacterDetail(choice),
    characterDetailLevel: CHARACTER_DETAIL_CHOICES.indexOf(choice.pending),
    onApplyCharacterDetail: () => setChoice(applyPendingCharacterDetail(choice, commit)),
    onCharacterDetailInput: (level: number) => {
      const next = CHARACTER_DETAIL_CHOICES[level];
      if (next === undefined) return;
      setChoice(current => selectCharacterDetail(current, next));
    },
    resetCharacterDetail: () => setChoice(resetCharacterDetail)
  };
};

export const useGraphicsSettings = ({
  applyCharacterDetail, applyDetail, applyResolution, characterDetail, detail, highlights: appliedHighlights,
  recommended, resolution, setHighlights, setTone, tone
}: GraphicsSettingsOptions) => {
  const { i18n } = useLingui();
  const detailLevels = getDetailLevels(recommended, i18n);
  const pendingGraphics = usePendingGraphics(detail);
  const pendingResolution = usePendingChoice(resolution);
  const pendingCharacterDetail = usePendingCharacterDetail(characterDetail, applyCharacterDetail);
  const liveTone = useLiveTone(tone, setTone);
  /** Highlights / glare applies live on every slider move (one shared uniform, no recompile). */
  const [highlights, onHighlightsInput] = useSetting(appliedHighlights, setHighlights);
  const toggleRows = getQualityToggleRows(
    pendingGraphics.pending.detail,
    getQualityToggleStates(pendingGraphics.pending.detail, pendingGraphics.pending.overrides),
    i18n
  );
  const { detail: pendingDetail, overrides: pendingOverrides } = pendingGraphics.pending;
  return {
    ...liveTone,
    ambientOcclusion: getAmbientOcclusionChoice(pendingDetail, pendingOverrides),
    ambientOcclusionOptions: getAmbientOcclusionOptions(pendingDetail, i18n),
    autoExposure: getAutoExposureSlider(pendingDetail, pendingOverrides, i18n),
    bloom: getBloomChoice(pendingGraphics.pending.detail, pendingGraphics.pending.overrides),
    bloomOptions: getBloomOptions(i18n),
    canApplyCharacterDetail: pendingCharacterDetail.canApplyCharacterDetail,
    canApplyDetail: pendingGraphics.canApply,
    canApplyResolution: pendingResolution.canApply,
    characterDetailLevel: pendingCharacterDetail.characterDetailLevel,
    characterDetailLevels: getCharacterDetailLevels(i18n),
    colourPrecision: getSceneTargetChoice(
      pendingGraphics.pending.detail,
      pendingGraphics.pending.overrides
    ),
    colourPrecisionOptions: getColourPrecisionOptions(pendingGraphics.pending.detail, i18n),
    detailLevel: QUALITY_LEVELS.indexOf(pendingGraphics.pending.detail),
    detailLevels,
    highlights,
    lawnDepth: getLawnDepthChoice(pendingGraphics.pending.detail, pendingGraphics.pending.overrides),
    lawnDepthOptions: getLawnDepthOptions(i18n),
    resolution: pendingResolution.pending,
    sunRays: getSunRaysSlider(pendingDetail, pendingOverrides, i18n),
    toggleRows,
    toggleSummary: getToggleSummary(toggleRows, i18n),
    toneOptions: getToneOptions(i18n),
    waterReflections: getWaterReflectionsChoice(pendingDetail, pendingOverrides),
    waterReflectionOptions: getWaterReflectionOptions(pendingDetail, i18n),
    onApplyCharacterDetail: pendingCharacterDetail.onApplyCharacterDetail,
    onApplyDetail: () => pendingGraphics.apply(applyDetail ?? reloadWithDetail),
    onAmbientOcclusionChange: pendingGraphics.setAmbientOcclusion,
    onApplyResolution: () => pendingResolution.apply(applyResolution),
    onAutoExposureInput: pendingGraphics.setAutoExposure,
    onBloomChange: pendingGraphics.setBloom,
    onCharacterDetailInput: pendingCharacterDetail.onCharacterDetailInput,
    onColourPrecisionChange: pendingGraphics.setSceneTarget,
    onDetailInput: (level: number) => {
      pendingGraphics.selectDetail(QUALITY_LEVELS[level]!);
      pendingCharacterDetail.resetCharacterDetail();
    },
    onHighlightsInput,
    onLawnDepthChange: pendingGraphics.setLawnDepth,
    onResolutionChange: pendingResolution.setPending,
    onSunRaysInput: pendingGraphics.setSunRays,
    onToggleChange: pendingGraphics.setToggle,
    onWaterReflectionsChange: pendingGraphics.setWaterReflections
  };
};
