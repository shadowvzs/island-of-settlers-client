import {
  AMBIENT_OCCLUSION_LEVELS,
  type AmbientOcclusion,
  BLOOM_QUALITIES,
  type BloomQuality,
  ICE_FLOE_LEVELS,
  LAWN_DEPTHS,
  type LawnDepth,
  QUALITY_PRESETS,
  type QualityLevel,
  type QualityPreset,
  readAmbientOcclusion,
  readWaterReflections,
  SCENE_TARGETS,
  type SceneTarget,
  VOLUMETRIC_LIGHT_LEVELS,
  WATER_REFLECTION_LEVELS,
  type WaterReflections
} from "./quality";
import { VOLUMETRIC_LIGHT_MAX_STRENGTH } from "./volumetric-light";

/**
 * Visual-only boolean features the player may switch one by one (Settings > Graphics). Each one
 * has a working off path, never touches gameplay or simulation, and takes effect when the
 * island is rebuilt in place (Detail apply), never by a page reload.
 */
export const QUALITY_TOGGLES = [
  "sunShadows",
  "refraction",
  "grass",
  "rockDetail",
  "skyEnvironment",
  "atmosphere",
  "atmosphereBanks",
  "weatherParticles",
  "animalSilhouettes",
  "trafficWear",
  "iceFloes"
] as const satisfies readonly (keyof QualityPreset)[];

export type QualityToggle = (typeof QUALITY_TOGGLES)[number];

/** Toggles only some Detail levels offer; the others keep their preset value (off). */
const TOGGLE_LEVELS: Partial<Record<QualityToggle, readonly QualityLevel[]>> = {
  iceFloes: ICE_FLOE_LEVELS
};

/** Whether a Detail level offers a visual-feature checkbox (most are offered on every level). */
export const canChooseQualityToggle = (level: QualityLevel, toggle: QualityToggle) =>
  TOGGLE_LEVELS[toggle]?.includes(level) ?? true;

/**
 * Only the settings the player changed away from the Detail level's default: the toggles and the
 * choices (`sceneTarget` colour precision, `lawnDepth` lawn depth, `bloom`, `ambientOcclusion`,
 * `waterReflections`) and the `sunRays` and `autoExposure` strength sliders (percent).
 */
export type QualityOverrides = Partial<Record<QualityToggle, boolean>> & {
  ambientOcclusion?: AmbientOcclusion;
  /**
   * R11c Auto-exposure slider in percent (0..100, absent = 100): 0 keeps the fixed exposure (no
   * pass, no target), lower values scale how far the possessed eye adapts.
   */
  autoExposure?: number;
  bloom?: BloomQuality;
  lawnDepth?: LawnDepth;
  sceneTarget?: SceneTarget;
  /**
   * R06c Sun rays slider in percent (0..200, absent = 100): 0 drops the possessed sun shafts (no
   * pass, no target), 200 doubles their intensity.
   */
  sunRays?: number;
  waterReflections?: WaterReflections;
};

/** Whether a Detail level offers the Ambient occlusion choice (Medium and High). */
export const canChooseAmbientOcclusion = (level: QualityLevel) => AMBIENT_OCCLUSION_LEVELS.includes(level);

/** Whether a Detail level offers the Water reflections choice (Medium and High). */
export const canChooseWaterReflections = (level: QualityLevel) => WATER_REFLECTION_LEVELS.includes(level);

/** Whether a Detail level offers the Sun rays slider (High). */
export const canChooseSunRays = (level: QualityLevel) => VOLUMETRIC_LIGHT_LEVELS.includes(level);

/** Whether a Detail level offers the Auto-exposure slider (where R11c runs: Medium and High). */
export const canChooseAutoExposure = (level: QualityLevel) =>
  QUALITY_PRESETS[level].exposureMode !== "fixed";

const PERCENT = 100;
/** Both strength sliders default to 100 %: the level's own look. */
export const DEFAULT_STRENGTH_PERCENT = PERCENT;
export const SUN_RAYS_MAX_PERCENT = VOLUMETRIC_LIGHT_MAX_STRENGTH * PERCENT;
export const AUTO_EXPOSURE_MAX_PERCENT = PERCENT;

const clampPercent = (value: number, max: number) => Math.min(max, Math.max(0, Math.round(value)));

/**
 * A stored slider percent, or undefined when unreadable. The Sun rays setting was a checkbox
 * before the slider: its stored `false` reads as 0 and `true` as 100.
 */
const readStrengthPercent = (value: unknown, max: number): number | undefined => {
  if (typeof value === "boolean") return value ? DEFAULT_STRENGTH_PERCENT : 0;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return clampPercent(value, max);
};

/** The slider percent worth storing: undefined at the default and where the level has no slider. */
const keptStrengthPercent = (value: number | undefined, max: number, offered: boolean) => {
  if (value === undefined || !offered) return undefined;
  const percent = clampPercent(value, max);
  return percent === DEFAULT_STRENGTH_PERCENT ? undefined : percent;
};

const isBloomQuality = (value: unknown): value is BloomQuality =>
  (BLOOM_QUALITIES as readonly unknown[]).includes(value);

const isLawnDepth = (value: unknown): value is LawnDepth =>
  (LAWN_DEPTHS as readonly unknown[]).includes(value);

const isSceneTarget = (value: unknown): value is SceneTarget =>
  (SCENE_TARGETS as readonly unknown[]).includes(value);

const isQualityToggle = (value: string): value is QualityToggle =>
  (QUALITY_TOGGLES as readonly string[]).includes(value);

/** The overrides that really differ from the level's defaults. */
export const normalizeQualityOverrides = (
  level: QualityLevel,
  overrides: QualityOverrides
): QualityOverrides => {
  const defaults = QUALITY_PRESETS[level];
  const kept: QualityOverrides = {};
  for (const toggle of QUALITY_TOGGLES) {
    const value = overrides[toggle];
    if (value !== undefined && value !== defaults[toggle] && canChooseQualityToggle(level, toggle))
      kept[toggle] = value;
  }
  if (overrides.bloom !== undefined && overrides.bloom !== defaults.bloom) kept.bloom = overrides.bloom;
  const ambientOcclusion = overrides.ambientOcclusion;
  if (ambientOcclusion !== undefined && ambientOcclusion !== defaults.ambientOcclusion &&
    canChooseAmbientOcclusion(level)) kept.ambientOcclusion = ambientOcclusion;
  if (overrides.lawnDepth !== undefined && overrides.lawnDepth !== defaults.lawnDepth)
    kept.lawnDepth = overrides.lawnDepth;
  if (overrides.sceneTarget !== undefined && overrides.sceneTarget !== defaults.sceneTarget)
    kept.sceneTarget = overrides.sceneTarget;
  const waterReflections = overrides.waterReflections;
  if (waterReflections !== undefined && waterReflections !== defaults.waterReflections &&
    canChooseWaterReflections(level)) kept.waterReflections = waterReflections;
  const sunRays = keptStrengthPercent(overrides.sunRays, SUN_RAYS_MAX_PERCENT, canChooseSunRays(level));
  if (sunRays !== undefined) kept.sunRays = sunRays;
  const autoExposure = keptStrengthPercent(
    overrides.autoExposure, AUTO_EXPOSURE_MAX_PERCENT, canChooseAutoExposure(level));
  if (autoExposure !== undefined) kept.autoExposure = autoExposure;
  return kept;
};

/** The Sun rays slider on a preset: 0 % drops the pass and its targets, the rest scales the intensity. */
const applySunRays = (preset: QualityPreset, percent: number | undefined) => {
  if (percent === undefined) return;
  if (percent === 0) preset.volumetricLight = "off";
  preset.volumetricLightStrength = percent / PERCENT;
};

/** The Auto-exposure slider on a preset: 0 % is the fixed exposure (no pass), the rest scales the eye. */
const applyAutoExposure = (preset: QualityPreset, percent: number | undefined) => {
  if (percent === undefined) return;
  if (percent === 0) preset.exposureMode = "fixed";
  preset.exposureStrength = percent / PERCENT;
};

/** The preset of a level with the player's overrides applied; the shared preset when none. */
export const resolveQualityPreset = (
  level: QualityLevel,
  overrides: QualityOverrides = {}
): QualityPreset => {
  const { autoExposure, sunRays, ...kept } = normalizeQualityOverrides(level, overrides);
  const unchanged = autoExposure === undefined && sunRays === undefined && Object.keys(kept).length === 0;
  if (unchanged) return QUALITY_PRESETS[level];
  const preset: QualityPreset = { ...QUALITY_PRESETS[level], ...kept };
  applySunRays(preset, sunRays);
  applyAutoExposure(preset, autoExposure);
  return preset;
};

/** The checkbox states shown for a level: its defaults plus the overrides. */
export const getQualityToggleStates = (
  level: QualityLevel,
  overrides: QualityOverrides
): Record<QualityToggle, boolean> => {
  const preset = resolveQualityPreset(level, overrides);
  return Object.fromEntries(QUALITY_TOGGLES.map(toggle => [toggle, preset[toggle]])) as
    Record<QualityToggle, boolean>;
};

/** One checkbox changed; a value equal to the level's default drops its override. */
export const setQualityToggle = (
  level: QualityLevel,
  overrides: QualityOverrides,
  toggle: QualityToggle,
  checked: boolean
): QualityOverrides => normalizeQualityOverrides(level, { ...overrides, [toggle]: checked });

/** The bloom shown for a level: its default unless the player chose another. */
export const getBloomChoice = (
  level: QualityLevel,
  overrides: QualityOverrides
): BloomQuality => overrides.bloom ?? QUALITY_PRESETS[level].bloom;

/** The bloom changed; a value equal to the level's default drops its override. */
export const setBloomChoice = (
  level: QualityLevel,
  overrides: QualityOverrides,
  bloom: BloomQuality
): QualityOverrides => normalizeQualityOverrides(level, { ...overrides, bloom });

/** The ambient occlusion shown for a level: its default unless the player chose another. */
export const getAmbientOcclusionChoice = (
  level: QualityLevel,
  overrides: QualityOverrides
): AmbientOcclusion => normalizeQualityOverrides(level, overrides).ambientOcclusion ??
  QUALITY_PRESETS[level].ambientOcclusion;

/** The ambient occlusion changed; a value equal to the level's default drops its override. */
export const setAmbientOcclusionChoice = (
  level: QualityLevel,
  overrides: QualityOverrides,
  ambientOcclusion: AmbientOcclusion
): QualityOverrides => normalizeQualityOverrides(level, { ...overrides, ambientOcclusion });

/** The water reflections shown for a level: its default unless the player chose another. */
export const getWaterReflectionsChoice = (
  level: QualityLevel,
  overrides: QualityOverrides
): WaterReflections => normalizeQualityOverrides(level, overrides).waterReflections ??
  QUALITY_PRESETS[level].waterReflections;

/** The water reflections changed; a value equal to the level's default drops its override. */
export const setWaterReflectionsChoice = (
  level: QualityLevel,
  overrides: QualityOverrides,
  waterReflections: WaterReflections
): QualityOverrides => normalizeQualityOverrides(level, { ...overrides, waterReflections });

/** The Sun rays slider percent for a level: 100 unless the player moved it, 0 where it cannot run. */
export const getSunRaysChoice = (level: QualityLevel, overrides: QualityOverrides) => {
  if (!canChooseSunRays(level)) return 0;
  return normalizeQualityOverrides(level, overrides).sunRays ?? DEFAULT_STRENGTH_PERCENT;
};

/** The Sun rays slider moved (percent); 100 drops its override. */
export const setSunRaysChoice = (
  level: QualityLevel,
  overrides: QualityOverrides,
  sunRays: number
): QualityOverrides => normalizeQualityOverrides(level, { ...overrides, sunRays });

/** The Auto-exposure slider percent for a level: 100 unless the player moved it, 0 where it cannot run. */
export const getAutoExposureChoice = (level: QualityLevel, overrides: QualityOverrides) => {
  if (!canChooseAutoExposure(level)) return 0;
  return normalizeQualityOverrides(level, overrides).autoExposure ?? DEFAULT_STRENGTH_PERCENT;
};

/** The Auto-exposure slider moved (percent); 100 drops its override. */
export const setAutoExposureChoice = (
  level: QualityLevel,
  overrides: QualityOverrides,
  autoExposure: number
): QualityOverrides => normalizeQualityOverrides(level, { ...overrides, autoExposure });

/** The lawn depth shown for a level: its default unless the player chose another. */
export const getLawnDepthChoice = (
  level: QualityLevel,
  overrides: QualityOverrides
): LawnDepth => overrides.lawnDepth ?? QUALITY_PRESETS[level].lawnDepth;

/** The lawn depth changed; a value equal to the level's default drops its override. */
export const setLawnDepthChoice = (
  level: QualityLevel,
  overrides: QualityOverrides,
  lawnDepth: LawnDepth
): QualityOverrides => normalizeQualityOverrides(level, { ...overrides, lawnDepth });

/** The colour precision shown for a level: its default unless the player chose another. */
export const getSceneTargetChoice = (
  level: QualityLevel,
  overrides: QualityOverrides
): SceneTarget => overrides.sceneTarget ?? QUALITY_PRESETS[level].sceneTarget;

/**
 * Colour precision choices of a level: Standard 8-bit and High 16-bit always, plus Off (no scene
 * target, the direct canvas path) where the level's default is Off.
 */
export const getSceneTargetChoices = (level: QualityLevel): readonly SceneTarget[] =>
  QUALITY_PRESETS[level].sceneTarget === "off"
    ? SCENE_TARGETS
    : SCENE_TARGETS.filter(target => target !== "off");

/** The colour precision changed; a value equal to the level's default drops its override. */
export const setSceneTargetChoice = (
  level: QualityLevel,
  overrides: QualityOverrides,
  sceneTarget: SceneTarget
): QualityOverrides => normalizeQualityOverrides(level, { ...overrides, sceneTarget });

export const areQualityOverridesEqual = (left: QualityOverrides, right: QualityOverrides) =>
  left.ambientOcclusion === right.ambientOcclusion &&
  left.autoExposure === right.autoExposure &&
  left.bloom === right.bloom &&
  left.lawnDepth === right.lawnDepth &&
  left.sceneTarget === right.sceneTarget &&
  left.sunRays === right.sunRays &&
  left.waterReflections === right.waterReflections &&
  QUALITY_TOGGLES.every(toggle => left[toggle] === right[toggle]);

/** Stored form: a JSON object of the changed toggles; empty when nothing differs. */
export const formatQualityOverrides = (overrides: QualityOverrides) => JSON.stringify(overrides);

/** Tolerant parse: anything unreadable or unknown is dropped. */
export const parseQualityOverrides = (raw: string | null): QualityOverrides => {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const overrides: QualityOverrides = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isQualityToggle(key) && typeof value === "boolean") overrides[key] = value;
      const ambientOcclusion = key === "ambientOcclusion" ? readAmbientOcclusion(value) : null;
      if (ambientOcclusion) overrides.ambientOcclusion = ambientOcclusion;
      if (key === "bloom" && isBloomQuality(value)) overrides.bloom = value;
      if (key === "lawnDepth" && isLawnDepth(value)) overrides.lawnDepth = value;
      if (key === "sceneTarget" && isSceneTarget(value)) overrides.sceneTarget = value;
      const sunRays = key === "sunRays" ? readStrengthPercent(value, SUN_RAYS_MAX_PERCENT) : undefined;
      if (sunRays !== undefined) overrides.sunRays = sunRays;
      const autoExposure = key === "autoExposure"
        ? readStrengthPercent(value, AUTO_EXPOSURE_MAX_PERCENT)
        : undefined;
      if (autoExposure !== undefined) overrides.autoExposure = autoExposure;
      const waterReflections = key === "waterReflections" ? readWaterReflections(value) : null;
      if (waterReflections) overrides.waterReflections = waterReflections;
    }
    return overrides;
  } catch {
    return {};
  }
};
