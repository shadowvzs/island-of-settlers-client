import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { MUSIC_MESSAGES } from "../src/app/audio/messages";
import type { MusicTrack } from "../src/app/audio/music-catalog";
import {
  formatMusicTime,
  getMusicModeView,
  getMusicPlaybackView,
  getMusicPlaylistOptions,
  getMusicProgressView,
  getMusicStatusText,
  getMusicTrackCount,
  getMusicVolumeView
} from "../src/app/audio/music-player-helpers";
import { MusicPlayerView, type MusicPlayerViewProps } from "../src/app/audio/music-player-panel";
import type { MusicPlayerState } from "../src/app/audio/music-player-store";
import { createMusicPlayerActions } from "../src/app/audio/use-music-player";
import { renderWithI18n } from "./helpers/render-with-i18n";

// The mount helper reads the browser language store; markup checks need only the view.
vi.mock("../src/app/components/react-island", () => ({ mountReactIsland: vi.fn() }));

const tracks: MusicTrack[] = [
  { collection: "roman", filename: "forum.ogg", name: "Forum", url: "/forum.ogg" },
  { collection: "neutral", name: "Harbour Lanterns", url: "/harbour.ogg" }
];
const state = (overrides: Partial<MusicPlayerState> = {}): MusicPlayerState => ({
  collection: "roman", currentIndex: 1, currentTime: 65, duration: 130, ended: false, loopCurrent: false,
  muted: false, paused: true, repeatPlaylist: true,
  status: { kind: "track", track: "Harbour Lanterns" }, tracks, volume: .35, ...overrides
});
const noop = () => undefined;
const actions = createMusicPlayerActions(new Proxy({}, { get: () => noop }) as never);
const props = (current = state()): MusicPlayerViewProps => ({
  actions, collection: current.collection, currentIndex: String(current.currentIndex),
  loop: getMusicModeView(MUSIC_MESSAGES.transport.loop, current.loopCurrent), muted: current.muted,
  playback: getMusicPlaybackView(current), playlist: getMusicPlaylistOptions(current.tracks),
  progress: getMusicProgressView(current, null),
  repeat: getMusicModeView(MUSIC_MESSAGES.transport.repeat, current.repeatPlaylist),
  seekRef: { current: null }, status: getMusicStatusText(current.status),
  trackCount: getMusicTrackCount(current.tracks),
  transportDisabled: !current.tracks.length, volume: current.volume, volumeView: getMusicVolumeView(current),
  onScrub: noop, onScrubEnd: noop
});
const render = (current?: MusicPlayerState) => renderWithI18n(createElement(MusicPlayerView, props(current)));

describe("music player helpers", () => {
  it("formats times and treats unknown durations as zero", () => {
    expect(formatMusicTime(65.9)).toBe("1:05");
    expect(formatMusicTime(Number.NaN)).toBe("0:00");
    expect(formatMusicTime(-3)).toBe("0:00");
  });
  it("prefers the scrub draft over playback and disables seeking without a duration", () => {
    const view = getMusicProgressView(state(), 26);
    expect(view).toMatchObject({ disabled: false, max: 130, timeText: "0:26 / 2:10", value: 26 });
    expect(view.style).toEqual({ "--music-progress": "20%" });
    expect(getMusicProgressView(state({ duration: 0 }), null)).toMatchObject({ disabled: true, max: 1, value: 0 });
  });
  it("labels the toggle Play, Resume or Pause", () => {
    expect(getMusicPlaybackView(state({ currentTime: 0 })).toggleLabel).toBe("Play");
    expect(getMusicPlaybackView(state()).toggleLabel).toBe("Resume");
    expect(getMusicPlaybackView(state({ ended: true })).toggleLabel).toBe("Play");
    expect(getMusicPlaybackView(state({ paused: false }))).toEqual({
      deckClassName: "music-player__deck is-playing", toggleIcon: "musicPause", toggleLabel: "Pause"
    });
  });
  it("describes mute, volume and mode tooltips", () => {
    expect(getMusicVolumeView(state({ muted: true }))).toMatchObject({ muteLabel: "Unmute music", volumeText: "Muted" });
    expect(getMusicVolumeView(state())).toMatchObject({
      muteLabel: "Mute music", valueText: "35 percent", volumeText: "35%"
    });
    expect(getMusicModeView(MUSIC_MESSAGES.transport.repeat, true)).toEqual({
      label: "Repeat playlist", pressed: true, title: "Repeat playlist: on"
    });
  });
  it("numbers playlist entries by filename, falling back to the title", () => {
    expect(getMusicPlaylistOptions(tracks)).toEqual([
      { label: "01. forum.ogg", value: "0" }, { label: "02. Harbour Lanterns", value: "1" }
    ]);
  });
});

describe("music player markup", () => {
  it("orders status, controls deck, collection, count, playlist and upload", () => {
    const markup = render();
    const order = ['role="status"', 'aria-label="Music controls"', 'aria-label="Music collection"',
      "2 tracks", 'aria-label="Music playlist"', 'class="music-player__upload"'].map(part => markup.indexOf(part));
    expect(order.every(index => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(markup).not.toContain("<audio");
  });
  it("keeps the driver names, pressed modes and the 10-row playlist", () => {
    const markup = render();
    const names = ["Previous track", "Resume", "Stop", "Next track", "Track progress", "Music volume", "Mute music"];
    for (const name of names)
      expect(markup).toContain(`aria-label="${name}"`);
    expect(markup).toContain('aria-label="Loop current track" aria-pressed="false" class="music-player__icon-button"');
    expect(markup).toContain('aria-label="Repeat playlist" aria-pressed="true"');
    expect(markup).toContain('title="Repeat playlist: on"');
    expect(markup).toMatch(/<select aria-label="Music playlist" size="10">/);
    expect(markup).toContain('<option value="1" selected="">02. Harbour Lanterns</option>');
    expect(markup).toContain('<option value="roman" selected="">Roman</option>');
  });
  it("hides the file input inside the themed label and marks the deck while playing", () => {
    const markup = render(state({ paused: false }));
    expect(markup).toMatch(new RegExp('<label class="music-player__upload">.*Add local files<input accept="audio/\\*" ' +
      'aria-label="Choose local music files" class="music-player__file-input" multiple="" type="file"/></label>'));
    expect(markup).toContain('class="music-player__deck is-playing"');
    expect(markup).toContain('aria-label="Pause"');
  });
  it("disables transport and playlist on an empty local queue", () => {
    const markup = render(state({
      collection: "local", currentTime: 0, duration: 0, status: { kind: "emptyPlaylist" }, tracks: []
    }));
    expect(markup).toContain("Choose local audio files to create a playlist.");
    expect(markup).toContain('aria-label="Next track" class="music-player__icon-button" disabled=""');
    expect(markup).toContain('aria-label="Music playlist" disabled=""');
    expect(markup).toContain('aria-label="Track progress" aria-valuetext="0:00 of 0:00" disabled=""');
  });
});
