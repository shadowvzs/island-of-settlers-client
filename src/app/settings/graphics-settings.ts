import {
  type CharacterDetailChoice,
  parseCharacterDetail
} from "../../render-common/character-detail";
import {
  type ColorTone,
  DEFAULT_COLOR_TONE,
  isColorTone
} from "../../render-common/color-output";
import {
  applyLiteGround,
  type GroundShaderRequest
} from "../../render-common/ground-shader-variant";
import { formatHighlights, parseHighlights } from "../../render-common/highlights";
import { isQualityLevel, type QualityLevel } from "../../render-common/quality";
import {
  formatQualityOverrides,
  normalizeQualityOverrides,
  parseQualityOverrides,
  type QualityOverrides,
  resolveQualityPreset
} from "../../render-common/quality-overrides";
import {
  applyResolutionProfile,
  createResolutionState,
  isResolutionMode,
  type ResolutionMode,
  type ResolutionProfile,
  resolutionRequiresReload,
  type ResolutionState,
  resolveResolutionProfile
} from "../../render-common/resolution";
import { isWorkerNation } from "../../render-common/workers/worker-appearance";
import {
  DEFAULT_WORKER_COLOR,
  isWorkerColor,
  type WorkerColor
} from "../../render-common/workers/worker-colors";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import type { DayMode } from "../environment-controller";
import { generatorStorage } from "../map-generator/storage";
import { reloadPage } from "../page-reload";
import { choiceCodec, flagCodec, parsedCodec } from "../preferences/codecs";
import { PREFERENCES } from "../preferences/keys";
import { definePreference } from "../preferences/registry";
import {
  type AdaptivePerformanceSettings,
  formatAdaptivePerformance,
  parseAdaptivePerformance
} from "../render-budget/settings";
import {
  formatProbeFingerprint,
  parseProbeFingerprint,
  type ProbeFingerprint
} from "./probe-fingerprint";
import {
  formatSoundLayers,
  parseSoundLayers,
  parseVolume,
  type SoundLayer
} from "./sound-settings";

const isDayMode = (value: unknown): value is DayMode => value === "nature" || value === "sun";
const volumeCodec = (fallback?: number) => parsedCodec(
  raw => parseVolume(raw, fallback), (volume: number) => String(Math.round(volume * 100))
);

/** Adaptive performance (R09/C13 budget controller): Auto on by default. */
const adaptivePerformance = definePreference(
  PREFERENCES.adaptivePerformance, parsedCodec(parseAdaptivePerformance, formatAdaptivePerformance)
);
/** Character detail cap and cadence floor; "auto" follows the Detail level, its ✓ applies live. */
const characterDetail = definePreference(
  PREFERENCES.characterDetail, parsedCodec(parseCharacterDetail, (choice: CharacterDetailChoice) => choice)
);
/** Decorative life: birds, butterflies, critters (food animals always show); on by default. */
const critters = definePreference(PREFERENCES.critters, flagCodec(true));
/** Nature follows the day/night cycle; sun keeps a clear noon. Nature is the normal game. */
const dayMode = definePreference(PREFERENCES.dayMode, choiceCodec(isDayMode, "nature"));
/**
 * Detail setting (quality level: shadows, refraction, plant detail, grass); the first run
 * stores the probe's recommendation (choose-graphics.ts). Null before the first run's probe chose one.
 */
const detail = definePreference(PREFERENCES.detail, choiceCodec(isQualityLevel, null));
const environmentVolume = definePreference(PREFERENCES.environmentVolume, volumeCodec());
/** Fog display is enabled by default; exploration continues while it is hidden. */
const fog = definePreference(PREFERENCES.fogOfWar, flagCodec(true));
/** Highlights / glare strength 0..1 (render-common/highlights.ts); 1 until the player lowers it, applied live. */
const highlights = definePreference(PREFERENCES.highlights, parsedCodec(parseHighlights, formatHighlights));
/** Statistics stay hidden until explicitly enabled in settings. */
const infoBox = definePreference(PREFERENCES.infoBox, flagCodec(false));
const masterVolume = definePreference(PREFERENCES.masterVolume, volumeCodec(1));
/** Minimap stays hidden until the player opens it (then remembered). */
const minimap = definePreference(PREFERENCES.minimap, flagCodec(false));
const musicVolume = definePreference(PREFERENCES.musicVolume, volumeCodec(.35));
/** Development tools "NPC traders": NPC buyers fill own trade offers; off by default. */
const npcTraders = definePreference(PREFERENCES.npcTraders, flagCodec(false));
/** Player portrait in the HUD corner; shown until the experience bar hides it. */
const portraitHidden = definePreference(PREFERENCES.portraitHidden, flagCodec(false));
/** Device fingerprint of the last probe; a different launch probes again (C12). Null before the first probe. */
const probeFingerprint = definePreference(
  PREFERENCES.probeFingerprint, parsedCodec(parseProbeFingerprint, formatProbeFingerprint)
);
/** Visual feature checkboxes the player changed away from the Detail level's defaults. */
const qualityOverrides = definePreference(
  PREFERENCES.qualityOverrides, parsedCodec(parseQualityOverrides, formatQualityOverrides)
);
/** Detail level the first run's device probe recommended (marked on the slider). */
const recommendedDetail = definePreference(PREFERENCES.recommendedDetail, choiceCodec(isQualityLevel, null));
/** Resolution setting (pixel ratio cap, MSAA); "auto" by default. */
const resolution = definePreference(PREFERENCES.resolution, choiceCodec(isResolutionMode, "auto"));
/** Every mine field counts as surveyed (until geologists exist); off by default. */
const revealOre = definePreference(PREFERENCES.revealOre, flagCodec(false));
/** Sound is off until the player switches it on (then remembered). */
const sound = definePreference(PREFERENCES.sound, flagCodec(false));
const soundLayersOff = definePreference(
  PREFERENCES.soundLayersOff, parsedCodec(parseSoundLayers, formatSoundLayers)
);
/** Tone setting (Auto / Vivid / Filmic tonemapping); applied live. */
const tone = definePreference(PREFERENCES.tone, choiceCodec(isColorTone, DEFAULT_COLOR_TONE));
/** Tunic colour of the workers (palette id); blue by default. */
const workerColor = definePreference(PREFERENCES.workerColor, choiceCodec(isWorkerColor, DEFAULT_WORKER_COLOR));
const workerNation = definePreference(PREFERENCES.workerNation, choiceCodec(isWorkerNation, "roman"));

/** Every stored setting of the lab (graphics, info box, critters, sound). */
export const settingsStorage = {
  readDayMode: (): DayMode => dayMode.read(),
  readAdaptivePerformance: (): AdaptivePerformanceSettings => adaptivePerformance.read(),
  /** Character detail choice; "auto" follows the Detail level. */
  readCharacterDetail: (): CharacterDetailChoice => characterDetail.read(),
  readCritters: () => critters.read(),
  readFog: () => fog.read(),
  readHighlights: () => highlights.read(),
  readInfoBox: () => infoBox.read(),
  readMinimap: () => minimap.read(),
  readPortraitHidden: () => portraitHidden.read(),
  readProbeFingerprint: (): ProbeFingerprint | null => probeFingerprint.read(),
  readRevealOre: () => revealOre.read(),
  readEnvironmentVolume: () => environmentVolume.read(),
  readMasterVolume: () => masterVolume.read(),
  readMusicVolume: () => musicVolume.read(),
  readNpcTraders: () => npcTraders.read(),
  readRecommended: (): QualityLevel | null => recommendedDetail.read(),
  /** Stored Detail level; null before the first run's probe chose one. */
  readDetail: (): QualityLevel | null => detail.read(),
  readQualityOverrides: (): QualityOverrides => qualityOverrides.read(),
  readResolution: (): ResolutionMode => resolution.read(),
  readTone: (): ColorTone => tone.read(),
  readSound: () => sound.read(),
  readSoundLayersOff: () => soundLayersOff.read(),
  /** Last island choice of the World form (landform, rivers, forest, mountains, size, theme). */
  readIsland: generatorStorage.read,
  readWorkerNation: (): WorkerNation => workerNation.read(),
  readWorkerColor: (): WorkerColor => workerColor.read(),
  writeAdaptivePerformance: (settings: AdaptivePerformanceSettings) => { adaptivePerformance.write(settings); },
  writeCharacterDetail: (choice: CharacterDetailChoice) => { characterDetail.write(choice); },
  writeFog: (visible: boolean) => { fog.write(visible); },
  writeHighlights: (strength: number) => { highlights.write(strength); },
  writeDayMode: (mode: DayMode) => { dayMode.write(mode); },
  writeCritters: (enabled: boolean) => { critters.write(enabled); },
  writeEnvironmentVolume: (volume: number) => { environmentVolume.write(volume); },
  writeMasterVolume: (volume: number) => { masterVolume.write(volume); },
  writeMusicVolume: (volume: number) => { musicVolume.write(volume); },
  writeRecommended: (level: QualityLevel) => { recommendedDetail.write(level); },
  writeSound: (enabled: boolean) => { sound.write(enabled); },
  writeSoundLayersOff: (layers: ReadonlySet<SoundLayer>) => { soundLayersOff.write(layers); },
  writeInfoBox: (visible: boolean) => { infoBox.write(visible); },
  writeMinimap: (visible: boolean) => { minimap.write(visible); },
  writePortraitHidden: (hidden: boolean) => { portraitHidden.write(hidden); },
  writeProbeFingerprint: (fingerprint: ProbeFingerprint) => { probeFingerprint.write(fingerprint); },
  writeRevealOre: (revealed: boolean) => { revealOre.write(revealed); },
  writeNpcTraders: (enabled: boolean) => { npcTraders.write(enabled); },
  writeDetail: (level: QualityLevel) => { detail.write(level); },
  writeQualityOverrides: (overrides: QualityOverrides) => { qualityOverrides.write(overrides); },
  writeResolution: (mode: ResolutionMode) => { resolution.write(mode); },
  writeTone: (value: ColorTone) => { tone.write(value); },
  writeIsland: generatorStorage.write,
  writeWorkerColor: (color: WorkerColor) => { workerColor.write(color); },
  writeWorkerNation: (nation: WorkerNation) => { workerNation.write(nation); }
};

/** Reloads the lab with its URL parameters changed by `update`. */
const reloadWithQuery = (update: (query: URLSearchParams) => void) => {
  const query = new URLSearchParams(location.search);
  update(query);
  const search = query.toString();
  reloadPage(`${location.pathname}${search ? `?${search}` : ""}`);
};

/** The Resolution choice of this run and its live drawing-buffer profile. */
export interface ResolutionSession {
  coarsePointer: boolean;
  /** The mode whose profile is active (not necessarily the stored choice after a pending reload). */
  mode: ResolutionMode;
  state: ResolutionState;
}

/** Touch-first devices resolve Auto to Fast; the game keeps one answer for the run. */
export const hasCoarsePointer = () => matchMedia("(pointer: coarse)").matches;

export const createResolutionSession = (
  mode: ResolutionMode,
  coarsePointer: boolean,
  profile: ResolutionProfile = resolveResolutionProfile(mode, coarsePointer)
): ResolutionSession => ({ coarsePointer, mode, state: createResolutionState(profile) });

/**
 * Applies a Resolution choice. MSAA is fixed when the WebGL context is created, so a change of the
 * resolved antialias setting reloads. All other choices update the pixel-ratio profile in place;
 * the render loop then resizes the drawing buffer and its dependent targets even when the CSS
 * viewport dimensions did not change. Gameplay and the renderer stay as they are.
 */
export const applyResolution = (
  session: ResolutionSession,
  mode: ResolutionMode,
  reload: () => void = reloadPage
): "live" | "reload" => {
  settingsStorage.writeResolution(mode);
  const next = resolveResolutionProfile(mode, session.coarsePointer);
  if (resolutionRequiresReload(session.state.profile, next)) {
    reload();
    return "reload";
  }
  session.mode = mode;
  applyResolutionProfile(session.state, next);
  return "live";
};

/** Applies a Detail level with the player's feature overrides (rebuilds the island in place). */
export type ApplyDetail = (level: QualityLevel, overrides: QualityOverrides) => void;

/** Shadow map, grass and the shaders are built at load: stores the choice and reloads. */
export const reloadWithDetail = (level: QualityLevel, overrides: QualityOverrides = {}) => {
  settingsStorage.writeDetail(level);
  settingsStorage.writeQualityOverrides(normalizeQualityOverrides(level, overrides));
  reloadWithQuery((query) => query.delete("quality"));
};

/**
 * The renderer's graphics options: the preset of the run's Detail level (choose-graphics.ts)
 * with the player's stored feature overrides, the ground shader (?ground= wins over the level's choice) and the stored Resolution setting.
 */
export const readGraphicsOptions = (
  detail: QualityLevel,
  ground: GroundShaderRequest,
  coarsePointer = hasCoarsePointer()
) => {
  const preset = resolveQualityPreset(detail, settingsStorage.readQualityOverrides());
  const resolutionMode = settingsStorage.readResolution();
  return {
    characterDetail: settingsStorage.readCharacterDetail(),
    groundShader: applyLiteGround(ground, preset.liteGround),
    quality: preset,
    resolution: resolveResolutionProfile(resolutionMode, coarsePointer),
    resolutionMode
  };
};

/** Revealed ore is baked into the terrain and rocks at load: stores the choice and reloads. */
export const reloadWithRevealOre = (revealed: boolean) => {
  settingsStorage.writeRevealOre(revealed);
  reloadWithQuery(() => undefined);
};

/** Loads a saved map (map editor slot, `?map=`): the camera goes to the map's start. */
export const reloadWithMap = (slotId: string) =>
  reloadWithQuery((query) => {
    query.set("map", slotId);
    query.delete("view");
  });
