import { describe, expect, it, vi } from "vitest";

import { type CinematicMusicTarget, createCinematicAudio } from "../src/app/audio/cinematic-audio";

const fakeMusic = (playing: boolean) => {
  const calls: string[] = [];
  let gain = 1;
  const target: CinematicMusicTarget = {
    playing: () => playing,
    playTrackById: trackId => {
      calls.push(`play:${trackId}`);
      return trackId !== "missing";
    },
    setCueGain: value => { gain = value; },
    stop: () => { calls.push("stop"); }
  };
  return { calls, gain: () => gain, target };
};

/** A manual animation-frame clock. */
const fakeFrames = () => {
  let time = 0;
  let pending: (() => void) | null = null;
  return {
    advance: (ms: number) => {
      time += ms;
      const callback = pending;
      pending = null;
      callback?.();
    },
    options: {
      cancelFrame: () => { pending = null; },
      now: () => time,
      requestFrame: (callback: () => void) => {
        pending = callback;
        return 1;
      }
    }
  };
};

describe("cinematic audio hooks (CIN6)", () => {
  it("plays known cues and ignores unknown ids", () => {
    const thunder = vi.fn();
    const audio = createCinematicAudio({ cues: { thunder, "victory-fanfare": vi.fn() }, music: () => null });
    audio.sound("thunder");
    audio.sound("no-such-cue");
    expect(thunder).toHaveBeenCalledTimes(1);
  });

  it("fades the playing track out, switches, and fades the new one in", () => {
    const music = fakeMusic(true);
    const frames = fakeFrames();
    const audio = createCinematicAudio({ ...frames.options, cues: { thunder: vi.fn(), "victory-fanfare": vi.fn() },
      music: () => music.target });
    audio.music("roman-theme", 1000);
    frames.advance(250);
    expect(music.gain()).toBeCloseTo(0.5);
    frames.advance(250);
    expect(music.calls).toEqual(["play:roman-theme"]);
    frames.advance(250);
    expect(music.gain()).toBeCloseTo(0.5);
    frames.advance(250);
    expect(music.gain()).toBe(1);
  });

  it("switches at once with no fade (a skipped step) and fades out to a stop for null", () => {
    const music = fakeMusic(true);
    const frames = fakeFrames();
    const audio = createCinematicAudio({ ...frames.options, cues: { thunder: vi.fn(), "victory-fanfare": vi.fn() },
      music: () => music.target });
    audio.music("roman-theme", 0);
    expect(music.calls).toEqual(["play:roman-theme"]);
    expect(music.gain()).toBe(1);
    audio.music(null, 400);
    frames.advance(400);
    expect(music.calls.at(-1)).toBe("stop");
    expect(music.gain()).toBe(1);
  });

  it("keeps the level for an unknown track and does nothing without a player", () => {
    const music = fakeMusic(false);
    const audio = createCinematicAudio({ cues: { thunder: vi.fn(), "victory-fanfare": vi.fn() },
      music: () => music.target });
    audio.music("missing", 0);
    expect(music.gain()).toBe(1);
    const silent = createCinematicAudio({ cues: { thunder: vi.fn(), "victory-fanfare": vi.fn() }, music: () => null });
    expect(() => silent.music("roman-theme", 500)).not.toThrow();
  });
});
