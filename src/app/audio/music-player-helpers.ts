import type { I18n, MessageDescriptor } from "@lingui/core";
import type { CSSProperties } from "react";

import { translateMessage } from "../../shared/i18n/translate";
import { MUSIC_MESSAGES } from "./messages";
import type { MusicTrack } from "./music-catalog";
import type { MusicPlayerState, MusicPlayerStatus } from "./music-player-store";

export interface MusicPlaylistOption {
  label: string;
  value: string;
}

export interface MusicProgressView {
  disabled: boolean;
  max: number;
  style: CSSProperties;
  timeText: string;
  value: number;
  valueText: string;
}

export interface MusicPlaybackView {
  deckClassName: string;
  toggleIcon: string;
  toggleLabel: string;
}

export interface MusicModeView {
  label: string;
  pressed: boolean;
  title: string;
}

export interface MusicVolumeView {
  muteLabel: string;
  style: CSSProperties;
  valueText: string;
  volumeText: string;
}

/** `m:ss`; anything unknown or negative reads `0:00`. */
export const formatMusicTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
};

/** Filled share of a themed range track, read by the CSS gradient. */
const rangeFill = (share: number): CSSProperties => ({ "--music-progress": `${share * 100}%` } as CSSProperties);

/** The seek bar follows playback, or the dragged value while the player scrubs. */
export const getMusicProgressView = (
  state: MusicPlayerState,
  scrubTo: number | null,
  i18n?: I18n
): MusicProgressView => {
  const { currentTime, duration, tracks } = state;
  const shown = scrubTo ?? currentTime;
  const value = Math.min(duration, Math.max(0, shown));
  const current = formatMusicTime(shown), total = formatMusicTime(duration);
  return {
    disabled: !tracks.length || !duration,
    max: duration || 1,
    style: rangeFill(duration ? shown / duration : 0),
    timeText: translateMessage(i18n, MUSIC_MESSAGES.progress.time, { current, total }),
    value,
    valueText: translateMessage(i18n, MUSIC_MESSAGES.progress.value, { current, total })
  };
};

/** A paused track part-way through resumes; a fresh or finished one plays. */
const pausedPlaybackLabel = ({ currentTime, ended }: MusicPlayerState): MessageDescriptor => {
  if (currentTime > 0 && !ended) return MUSIC_MESSAGES.transport.resume;
  return MUSIC_MESSAGES.transport.play;
};

export const getMusicPlaybackView = (state: MusicPlayerState, i18n?: I18n): MusicPlaybackView => {
  if (!state.paused) {
    return {
      deckClassName: "music-player__deck is-playing",
      toggleIcon: "musicPause",
      toggleLabel: translateMessage(i18n, MUSIC_MESSAGES.transport.pause)
    };
  }
  return {
    deckClassName: "music-player__deck",
    toggleIcon: "musicPlay",
    toggleLabel: translateMessage(i18n, pausedPlaybackLabel(state))
  };
};

/** Loop/repeat buttons keep their accessible name; the tooltip adds the state. */
export const getMusicModeView = (label: MessageDescriptor, enabled: boolean, i18n?: I18n): MusicModeView => {
  const text = translateMessage(i18n, label);
  return {
    label: text,
    pressed: enabled,
    title: translateMessage(i18n, enabled ? MUSIC_MESSAGES.mode.on : MUSIC_MESSAGES.mode.off, { label: text })
  };
};

export const getMusicVolumeView = ({ muted, volume }: MusicPlayerState, i18n?: I18n): MusicVolumeView => {
  const percent = Math.round(volume * 100);
  const muteLabel = translateMessage(i18n,
    muted ? MUSIC_MESSAGES.volume.unmute : MUSIC_MESSAGES.volume.mute);
  const volumeText = muted
    ? translateMessage(i18n, MUSIC_MESSAGES.volume.muted)
    : `${percent}%`;
  return {
    muteLabel,
    style: rangeFill(volume),
    valueText: translateMessage(i18n, MUSIC_MESSAGES.volume.percent, { percent }),
    volumeText
  };
};

/** Numbered filenames, values are queue indices. Track titles and filenames stay as they are. */
export const getMusicPlaylistOptions = (tracks: readonly MusicTrack[]): MusicPlaylistOption[] =>
  tracks.map((track, index) => ({
    label: `${String(index + 1).padStart(2, "0")}. ${track.filename ?? track.name}`,
    value: String(index)
  }));

export const getMusicTrackCount = (tracks: readonly MusicTrack[], i18n?: I18n) =>
  translateMessage(i18n, tracks.length === 1 ? MUSIC_MESSAGES.trackCount.one : MUSIC_MESSAGES.trackCount.other,
    { count: tracks.length });

/** The status line: track titles are data, the other states resolve through the active locale. */
export const getMusicStatusText = (status: MusicPlayerStatus, i18n?: I18n) => {
  if (status.kind === "idle") return "";
  if (status.kind === "track") return status.track;
  if (status.kind === "autoplayBlocked")
    return translateMessage(i18n, MUSIC_MESSAGES.status.autoplayBlocked, { track: status.track });
  if (status.kind === "emptyPlaylist")
    return translateMessage(i18n, MUSIC_MESSAGES.status.emptyPlaylist);
  return translateMessage(i18n, MUSIC_MESSAGES.status.unplayable);
};
