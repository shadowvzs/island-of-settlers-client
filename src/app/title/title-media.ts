import type { GameSettings } from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { audioGestures } from "../audio/audio-gesture";
import { type AudioLevels, audioLevels } from "../audio/audio-levels";
import { settingsStorage } from "../settings/graphics-settings";
import { TITLE_MEDIA_TYPES, TITLE_PROBE_TIMEOUT_MS } from "./constants";
import {
  titleBackgroundCandidates, titleFileUrl, titleMediaKind, titleMusicCandidates
} from "./helpers";

/**
 * Title page files by convention (owner 2026-11-12): each candidate in the build's `title/` folder is probed once
 * with a HEAD request; the first answer with a fitting media type is used, anything else is skipped silently.
 */
export interface TitleBackground {
  kind: "image" | "video";
  url: string;
}

type MediaPrefix = typeof TITLE_MEDIA_TYPES[keyof typeof TITLE_MEDIA_TYPES];

const fitsMedia = (response: Response, prefixes: readonly MediaPrefix[]) =>
  response.ok && prefixes.some(prefix => (response.headers.get("content-type") ?? "").startsWith(prefix));

/** True when the file exists as media (a dev server answers a missing file with the page: not media). */
const probe = async (url: string, prefixes: readonly MediaPrefix[], fetcher: typeof fetch) => {
  try {
    const response = await fetcher(url, { method: "HEAD", signal: AbortSignal.timeout(TITLE_PROBE_TIMEOUT_MS) });
    return fitsMedia(response, prefixes);
  } catch {
    return false;
  }
};

const firstFound = async (
  names: readonly string[], baseUrl: string, prefixes: readonly MediaPrefix[], fetcher: typeof fetch
) => {
  for (const name of names) if (await probe(titleFileUrl(baseUrl, name), prefixes, fetcher)) return name;
  return null;
};

/** The title background (video wins over an image), or null: the loading scene's painted art stays. */
export const findTitleBackground = async (
  settings: GameSettings | null, baseUrl: string, fetcher: typeof fetch = fetch
): Promise<TitleBackground | null> => {
  const prefixes = [TITLE_MEDIA_TYPES.video, TITLE_MEDIA_TYPES.image];
  const name = await firstFound(titleBackgroundCandidates(settings), baseUrl, prefixes, fetcher);
  if (!name) return null;
  return { kind: titleMediaKind(name), url: titleFileUrl(baseUrl, name) };
};

/** The title music URL, or null when no music file exists. */
export const findTitleMusic = async (
  settings: GameSettings | null, baseUrl: string, fetcher: typeof fetch = fetch
) => {
  const name = await firstFound(titleMusicCandidates(settings), baseUrl, [TITLE_MEDIA_TYPES.audio], fetcher);
  return name ? titleFileUrl(baseUrl, name) : null;
};

/** Music level after the sound switch and the master/music sliders (the music player's categories). */
export const titleMusicVolume = (soundOn: boolean, { master, music }: AudioLevels) => (soundOn ? master * music : 0);

/**
 * Loops the title music at the player's music level; silent while sound is off. Browsers allow playback only after
 * a gesture, so a refused start waits for the page's next one. Returns the stop function.
 */
export const playTitleMusic = (url: string) => {
  const audio = new Audio(url);
  audio.loop = true;
  const apply = () => { audio.volume = titleMusicVolume(settingsStorage.readSound(), audioLevels.getSnapshot()); };
  const play = () => { if (audio.volume > 0) void audio.play().catch(() => undefined); };
  apply();
  play();
  const stopLevels = audioLevels.subscribe(() => { apply(); play(); });
  const stopGesture = audioGestures.subscribe(play);
  return () => {
    stopLevels();
    stopGesture();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  };
};
