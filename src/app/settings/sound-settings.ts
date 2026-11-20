/** Sound categories the player can switch off one by one (see audio/soundscape-mix). */
export type SoundLayer = "rain" | "trees" | "water" | "wildlife";

export const SOUND_LAYERS: readonly SoundLayer[] = ["water", "trees", "rain", "wildlife"];

/** Environment volume when nothing is stored: moderate. */
export const DEFAULT_ENVIRONMENT_VOLUME = 0.6;

const isSoundLayer = (value: string): value is SoundLayer =>
  (SOUND_LAYERS as readonly string[]).includes(value);

/** Stored percent (0..100) -> volume 0..1; missing or invalid -> `fallback`. */
export const parseVolume = (stored: string | null, fallback = DEFAULT_ENVIRONMENT_VOLUME) => {
  if (stored === null || stored.trim() === "") return fallback;
  const percent = Number(stored);
  if (!Number.isFinite(percent)) return fallback;
  return Math.min(100, Math.max(0, percent)) / 100;
};

/** Stored comma list of switched off layers; unknown names are ignored. */
export const parseSoundLayers = (stored: string | null) =>
  new Set((stored ?? "").split(",").filter(isSoundLayer));

export const formatSoundLayers = (layers: ReadonlySet<SoundLayer>) =>
  SOUND_LAYERS.filter((layer) => layers.has(layer)).join(",");
