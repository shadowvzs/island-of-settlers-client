import type { I18n } from "@lingui/core";

import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { translateMessage } from "../../shared/i18n/translate";
import { createExternalStore } from "../components/ui-store";
import { settingsStorage } from "../settings/graphics-settings";
import { audioLevels, setMusicVolume } from "./audio-levels";
import { MUSIC_MESSAGES } from "./messages";
import { createMusicAutoplay } from "./music-autoplay";
import { bundledMusicTracks, musicForCollection, type MusicTrack } from "./music-catalog";
import {
  createThrottledPublisher,
  finiteSeconds,
  MUSIC_PROGRESS_INTERVAL_MS,
  type MusicPlayerState,
  type MusicPlayerStatus,
  type PublishClock
} from "./music-player-store";
import { nextMusicTrackAfterEnd } from "./music-playlist";

/** The parts of the native audio element the player uses (a fake one serves the tests). */
export type MusicAudio = Pick<HTMLAudioElement,
  "addEventListener" | "currentTime" | "duration" | "ended" | "load" | "muted" | "pause" | "paused" | "play" |
  "removeAttribute" | "removeEventListener" | "src" | "volume">;

export interface MusicPlayerServiceOptions {
  audio: MusicAudio;
  bundled: readonly MusicTrack[];
  clock?: PublishClock;
  collection: string;
  createObjectUrl?: (file: File) => string;
  /** Shared master level applied on top of the music category volume. */
  masterVolume?: () => number;
  /** Explicit player commands supersede a pending automatic startup request. */
  onUserAction?: () => void;
  /** Notifies Settings when the music player changes its category volume. */
  onVolumeChange?: (volume: number) => void;
  revokeObjectUrl?: (url: string) => void;
  /** Starting music category volume; defaults to the audio element's volume. */
  volume?: number;
}

const EMPTY_PLAYLIST_STATUS: MusicPlayerStatus = { kind: "emptyPlaylist" };
const UNPLAYABLE_STATUS: MusicPlayerStatus = { kind: "unplayable" };
const PROGRESS_EVENTS = ["durationchange", "loadedmetadata", "timeupdate"] as const;
const PLAYBACK_EVENTS = ["emptied", "pause", "play", "volumechange"] as const;

const wrapIndex = (index: number, count: number) => ((index % count) + count) % count;
/** A bundled track's catalog id is its file name without the extension (`roman/roman-x-01.ogg` -> `roman-x-01`). */
const trackIdOf = (track: MusicTrack) => track.id ?? track.filename?.replace(/\.ogg$/, "") ?? null;

/**
 * One detached native audio element and its queue, outside React: closing the window keeps it playing.
 * State reaches the view through a store; progress publications are throttled.
 */
export const createMusicPlayerService = (options: MusicPlayerServiceOptions) => {
  const { audio, bundled } = options;
  const createObjectUrl = options.createObjectUrl ?? (file => URL.createObjectURL(file));
  const revokeObjectUrl = options.revokeObjectUrl ?? (url => URL.revokeObjectURL(url));
  let collection = options.collection, current = 0, hasSource = false, local: MusicTrack[] = [];
  let loopCurrent = false, playAttempt = 0, repeatPlaylist = true;
  let disposed = false;
  let status: MusicPlayerStatus = { kind: "idle" };
  let tracks: readonly MusicTrack[] = [];
  let musicVolume = options.volume ?? audio.volume;
  /** Campaign cue fade (CIN6) on top of the category and master levels; never stored. */
  let cueGain = 1;
  const applyVolume = () => { audio.volume = musicVolume * cueGain * (options.masterVolume?.() ?? 1); };
  applyVolume();
  const snapshot = (): MusicPlayerState => ({
    collection, currentIndex: current, currentTime: finiteSeconds(audio.currentTime),
    duration: finiteSeconds(audio.duration), ended: audio.ended, loopCurrent, muted: audio.muted,
    paused: audio.paused, repeatPlaylist, status, tracks, volume: musicVolume
  });
  const store = createExternalStore(snapshot());
  const publisher = createThrottledPublisher(() => {
    if (!disposed) store.set(snapshot());
  }, MUSIC_PROGRESS_INTERVAL_MS, options.clock);
  const play = () => {
    if (disposed || !tracks.length) return Promise.resolve(false);
    const attempt = ++playAttempt, track = tracks[current]!;
    if (audio.ended) audio.currentTime = 0;
    return audio.play().then(() => !disposed && playAttempt === attempt).catch((error: unknown) => {
      if (playAttempt !== attempt || tracks[current] !== track) return false;
      // A decode failure also rejects play(). Keep its useful error instead of relabelling
      // the unsupported file as an autoplay permission problem.
      if (status.kind === "unplayable" || error instanceof Error && error.name === "NotSupportedError")
        status = UNPLAYABLE_STATUS;
      else status = { kind: "autoplayBlocked", track: track.name };
      publisher.now();
      return false;
    });
  };
  const select = (index: number, start: boolean) => {
    if (disposed || !tracks.length) return;
    playAttempt++; audio.pause();
    current = wrapIndex(index, tracks.length);
    const track = tracks[current]!;
    audio.src = track.url; hasSource = true; status = { kind: "track", track: track.name };
    publisher.now();
    if (start) play();
  };
  const tracksFor = (value: string) => {
    if (value === "local") return local;
    if (value === "all") return musicForCollection([...bundled, ...local], value);
    return musicForCollection(bundled, value);
  };
  const clearSource = () => {
    playAttempt++; audio.pause(); audio.removeAttribute("src"); hasSource = false; audio.load();
  };
  const refresh = (start: boolean) => {
    if (disposed) return;
    clearSource();
    tracks = tracksFor(collection);
    status = tracks.length ? { kind: "idle" } : EMPTY_PLAYLIST_STATUS;
    select(0, start);
    publisher.now();
  };
  const handleEnded = () => {
    const following = nextMusicTrackAfterEnd(current, tracks.length, loopCurrent, repeatPlaylist);
    publisher.now();
    if (following === null) return;
    if (following !== current) return select(following, true);
    audio.currentTime = 0; play();
  };
  const handleError = () => {
    if (!hasSource) return;
    status = UNPLAYABLE_STATUS;
    publisher.now();
  };
  for (const event of PROGRESS_EVENTS) audio.addEventListener(event, publisher.request);
  for (const event of PLAYBACK_EVENTS) audio.addEventListener(event, publisher.now);
  audio.addEventListener("ended", handleEnded);
  audio.addEventListener("error", handleError);
  refresh(false);
  /** A cue (CIN6 step, map script) starts a track of the full list; `loop` sets the repeat-one mode when given. */
  const playCue = (trackId: string, loop?: boolean) => {
    const index = tracksFor("all").findIndex(track => trackIdOf(track) === trackId);
    if (disposed || index < 0) return false;
    options.onUserAction?.();
    if (collection !== "all") {
      collection = "all";
      refresh(false);
    }
    if (loop !== undefined) loopCurrent = loop;
    select(index, true);
    return true;
  };
  /** The player's own choice of music ends a cue's volume (a script `playMusic` volume, a fade in progress). */
  const resetCueGain = () => { cueGain = 1; applyVolume(); };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const event of PROGRESS_EVENTS) audio.removeEventListener(event, publisher.request);
    for (const event of PLAYBACK_EVENTS) audio.removeEventListener(event, publisher.now);
    audio.removeEventListener("ended", handleEnded);
    audio.removeEventListener("error", handleError);
    publisher.cancel();
    clearSource();
    for (const track of local) revokeObjectUrl(track.url);
    local = []; tracks = []; current = 0; status = { kind: "idle" };
    store.set(snapshot());
  };
  return {
    dispose,
    store,
    playAutomatically: play,
    addLocalFiles: (files: readonly File[]) => {
      if (disposed || !files.length) return;
      options.onUserAction?.();
      local = [...local, ...files.map(file => ({
        collection: "local" as const, filename: file.name, name: file.name, url: createObjectUrl(file)
      }))];
      collection = "local"; refresh(false);
    },
    handlePageHide: (persisted: boolean) => {
      if (disposed) return;
      if (!persisted) return dispose();
      playAttempt++; audio.pause();
      publisher.now();
    },
    next: () => { options.onUserAction?.(); resetCueGain(); select(current + 1, true); },
    playSelected: () => { options.onUserAction?.(); return play(); },
    /** Campaign music cue (CIN6): plays a bundled track by catalog id from the full list; false when unknown. */
    playTrackById: (trackId: string) => playCue(trackId),
    /**
     * Map script music: a bundled track by catalog id, or an uploaded map track (added to the local list once).
     * `loop` repeats it; otherwise it plays once and the playlist goes on.
     */
    playCueTrack: (track: { id: string; name: string; url: string }, loop: boolean) => {
      if (disposed) return false;
      const known = tracksFor("all").some(listed => trackIdOf(listed) === track.id);
      if (!known) local = [...local, { collection: "local", id: track.id, name: track.name, url: track.url }];
      if (!known && collection === "all") refresh(false);
      return playCue(track.id, loop);
    },
    previous: () => { options.onUserAction?.(); resetCueGain(); select(current - 1, true); },
    seek: (seconds: number) => {
      options.onUserAction?.();
      const duration = finiteSeconds(audio.duration);
      if (!duration) return;
      audio.currentTime = Math.max(0, Math.min(duration, seconds));
      publisher.now();
    },
    selectCollection: (value: string) => {
      options.onUserAction?.(); resetCueGain(); collection = value; refresh(!audio.paused);
    },
    selectTrack: (index: number) => { options.onUserAction?.(); resetCueGain(); select(index, !audio.paused); },
    setVolume: (volume: number) => {
      options.onUserAction?.();
      musicVolume = Math.max(0, Math.min(1, volume));
      applyVolume();
      if (musicVolume > 0) audio.muted = false;
      options.onVolumeChange?.(musicVolume);
      publisher.now();
    },
    /** The campaign cue fade gain 0..1 (CIN6 music steps fade through it). */
    setCueGain: (gain: number) => { cueGain = Math.max(0, Math.min(1, gain)); applyVolume(); },
    /** Reapplies the shared master level (called when Settings changes it). */
    syncVolume: () => { applyVolume(); publisher.now(); },
    stop: () => { options.onUserAction?.(); playAttempt++; audio.pause(); audio.currentTime = 0; publisher.now(); },
    toggleLoop: () => { options.onUserAction?.(); loopCurrent = !loopCurrent; publisher.now(); },
    toggleMute: () => { options.onUserAction?.(); audio.muted = !audio.muted; },
    togglePlayback: () => {
      options.onUserAction?.();
      if (audio.paused) return play();
      audio.pause();
    },
    toggleRepeat: () => { options.onUserAction?.(); repeatPlaylist = !repeatPlaylist; publisher.now(); }
  };
};

export type MusicPlayerService = ReturnType<typeof createMusicPlayerService>;

let browserPlayer: MusicPlayerService | undefined;

/** The page's player if one was created (campaign music cues never create it themselves). */
export const existingBrowserMusicPlayer = () => browserPlayer ?? null;

/** The page's player: scores stream on demand; local files stay in this browser until the page hides. */
export const createBrowserMusicPlayer = (nation: WorkerNation, i18n?: I18n): MusicPlayerService => {
  if (browserPlayer) return browserPlayer;
  const audio = document.createElement("audio");
  let cancelAutomatic: () => void = () => undefined;
  const levels = audioLevels.getSnapshot();
  audio.preload = "none"; audio.volume = levels.music * levels.master;
  const updatePlaybackLabel = () =>
    audio.setAttribute("aria-label", translateMessage(i18n, MUSIC_MESSAGES.player.playback));
  updatePlaybackLabel();
  i18n?.on("change", updatePlaybackLabel);
  const service = createMusicPlayerService({ audio, bundled: bundledMusicTracks(), collection: nation,
    masterVolume: () => audioLevels.getSnapshot().master, onUserAction: () => cancelAutomatic(),
    onVolumeChange: setMusicVolume,
    volume: levels.music });
  const automatic = createMusicAutoplay({
    allowed: () => settingsStorage.readSound() && audioLevels.getSnapshot().master > 0 &&
      audioLevels.getSnapshot().music > 0,
    play: service.playAutomatically,
    state: service.store.getSnapshot
  });
  cancelAutomatic = automatic.cancel;
  const unsubscribeLevels = audioLevels.subscribe(() => service.syncVolume());
  const disposeAudio = service.dispose;
  let disposed = false;
  service.dispose = () => {
    if (disposed) return;
    disposed = true;
    automatic.cancel();
    disposeAudio();
    unsubscribeLevels();
    i18n?.removeListener("change", updatePlaybackLabel);
    window.removeEventListener("pagehide", handlePageHide);
    if (browserPlayer === service) browserPlayer = undefined;
  };
  const handlePageHide = (event: PageTransitionEvent) => {
    if (!event.persisted) return service.dispose();
    automatic.cancel();
    service.handlePageHide(true);
  };
  window.addEventListener("pagehide", handlePageHide);
  browserPlayer = service;
  return service;
};
