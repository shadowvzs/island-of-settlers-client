import { soundEntries } from "@shared/catalog";
import { describe, expect, it, vi } from "vitest";

import type { MapAudioAsset } from "../../island-of-settlers-shared/src/script/audio";
import { AUDIO_CUE_IDS, createAudioCuePlayer } from "../src/app/audio/audio-cues";
import { resolveAudioRef } from "../src/app/audio/audio-refs";
import { SCRIPT_SOUND_VOICE_LIMIT } from "../src/app/audio/constants";
import { createMusicCueFader } from "../src/app/audio/music-cue-fader";
import {
  createScriptAudio, type ScriptAudioLevels, type ScriptMusicTarget, type SoundVoice
} from "../src/app/audio/script-audio";

const HORN: MapAudioAsset = { data: "AAAA", durationSeconds: 2, id: "audio-1", kind: "sound", mimeType: "audio/ogg",
  name: "Horn" };
const MARCH: MapAudioAsset = { ...HORN, id: "audio-2", kind: "music", mimeType: "audio/mpeg", name: "March" };
const uploads = (assetId: string) => [HORN, MARCH].find(asset => asset.id === assetId);
const catalog = (id: string) => ({ id, kind: "catalog" as const });
const upload = (assetId: string) => ({ assetId, kind: "upload" as const });

const setup = (levels: Partial<ScriptAudioLevels> = {}, playing = false) => {
  const voices: { url: string; voice: SoundVoice & { ended: () => void } }[] = [];
  const calls: string[] = [];
  let gain = 1, time = 0;
  let pending: (() => void) | null = null;
  const target: ScriptMusicTarget = {
    playCueTrack: (track, loop) => { calls.push(`play:${track.id}:${loop ? "loop" : "once"}`); return true; },
    playing: () => playing,
    setCueGain: value => { gain = value; },
    stop: () => { calls.push("stop"); }
  };
  const cues = { play: vi.fn(() => true) };
  const log = vi.fn();
  const audio = createScriptAudio({
    createVoice: url => {
      const listeners = new Map<string, () => void>();
      const voice = { addEventListener: (type: string, listener: () => void) => { listeners.set(type, listener); },
        ended: () => listeners.get("ended")?.(), pause: vi.fn(), play: () => Promise.resolve(), volume: 1 };
      voices.push({ url, voice: voice as unknown as SoundVoice & { ended: () => void } });
      return voice as unknown as SoundVoice;
    },
    cues,
    fader: createMusicCueFader({ cancelFrame: () => { pending = null; }, now: () => time,
      requestFrame: callback => { pending = callback; return 1; } }),
    levels: () => ({ effects: .5, enabled: true, master: .8, music: 1, ...levels }),
    log,
    music: () => target,
    uploads
  });
  const advance = (ms: number) => {
    time += ms;
    const callback = pending;
    pending = null;
    callback?.();
  };
  return { advance, audio, calls, cues, gain: () => gain, log, voices };
};

describe("audio references", () => {
  it("resolves catalog files, synthesized cues and uploads of the right kind", () => {
    expect(resolveAudioRef(catalog("sound:thunder"), "sound", uploads))
      .toEqual({ cue: "cue:weather.thunder", kind: "cue", name: "Thunder" });
    const trumpet = resolveAudioRef(catalog("sound:garrisonTrumpet"), "sound", uploads);
    expect(trumpet?.kind === "file" && trumpet.url).toMatch(/garrison-first-occupation.*\.ogg/);
    const track = resolveAudioRef(catalog("music:harbour-lanterns"), "music", uploads);
    expect(track).toMatchObject({ id: "harbour-lanterns", kind: "file", name: "Harbour Lanterns" });
    expect(resolveAudioRef(upload("audio-2"), "music", uploads))
      .toEqual({ id: "upload:audio-2", kind: "file", name: "March", url: "data:audio/mpeg;base64,AAAA" });
    expect(resolveAudioRef(upload("audio-1"), "music", uploads)).toBeNull();
    expect(resolveAudioRef(upload("audio-9"), "sound", uploads)).toBeNull();
    expect(resolveAudioRef(catalog("music:harbour-lanterns"), "sound", uploads)).toBeNull();
    expect(resolveAudioRef(catalog("sound:kazoo"), "sound", uploads)).toBeNull();
  });

  it("registers exactly the cues the sound catalog names", () => {
    const named = soundEntries().flatMap(entry => (entry.sound.source.kind === "cue" ? [entry.sound.source.cue] : []));
    expect([...named].sort()).toEqual(AUDIO_CUE_IDS);
    const player = createAudioCuePlayer(() => null);
    expect(player.play("cue:weather.thunder", 1)).toBe(false);
    expect(player.play("cue:no.such", 1)).toBe(false);
  });
});

describe("script audio effects", () => {
  it("plays a cue and a file sound at the script volume times the effect and master levels", () => {
    const { audio, cues, voices } = setup();
    audio.apply({ kind: "playSound", sound: catalog("sound:thunder"), volume: .5 });
    expect(cues.play).toHaveBeenCalledWith("cue:weather.thunder", .5 * .5 * .8);
    audio.apply({ kind: "playSound", sound: upload("audio-1"), volume: 1 });
    expect(voices).toHaveLength(1);
    expect(voices[0]!.url).toBe("data:audio/ogg;base64,AAAA");
    expect(voices[0]!.voice.volume).toBeCloseTo(.4);
  });

  it("stays silent when sounds are off or a level is zero, and logs unknown references", () => {
    for (const levels of [{ enabled: false }, { master: 0 }, { effects: 0 }]) {
      const { audio, cues, voices } = setup(levels);
      audio.apply({ kind: "playSound", sound: catalog("sound:thunder"), volume: 1 });
      audio.apply({ kind: "playSound", sound: upload("audio-1"), volume: 1 });
      expect(cues.play).not.toHaveBeenCalled();
      expect(voices).toHaveLength(0);
    }
    const { audio, log } = setup();
    audio.apply({ kind: "playSound", sound: catalog("sound:kazoo"), volume: 1 });
    expect(log).toHaveBeenCalledWith("playSound sound:kazoo: unknown sound");
  });

  it("caps simultaneous file sounds and frees a voice when it ends", () => {
    const { audio, log, voices } = setup();
    const play = () => audio.apply({ kind: "playSound", sound: upload("audio-1"), volume: 1 });
    for (let index = 0; index <= SCRIPT_SOUND_VOICE_LIMIT; index++) play();
    expect(voices).toHaveLength(SCRIPT_SOUND_VOICE_LIMIT);
    expect(log).toHaveBeenCalledTimes(1);
    voices[0]!.voice.ended();
    play();
    expect(voices).toHaveLength(SCRIPT_SOUND_VOICE_LIMIT + 1);
  });

  it("fades the playing music out, starts the track in its mode and fades in to the script volume", () => {
    const { advance, audio, calls, gain } = setup({}, true);
    audio.apply({ fadeInSeconds: 2, fadeOutSeconds: 1, kind: "playMusic", loop: false, track: upload("audio-2"),
      volume: .5 });
    expect(calls).toEqual([]);
    advance(500);
    expect(gain()).toBeCloseTo(.5);
    advance(500);
    expect(calls).toEqual(["play:upload:audio-2:once"]);
    expect(gain()).toBe(0);
    advance(1000);
    expect(gain()).toBeCloseTo(.25);
    advance(1000);
    expect(gain()).toBeCloseTo(.5);
  });

  it("starts music at once when nothing plays, and not at all when the player wants no music", () => {
    const { audio, calls } = setup();
    audio.apply({ fadeInSeconds: 0, fadeOutSeconds: 1, kind: "playMusic", loop: true,
      track: catalog("music:harbour-lanterns"), volume: 1 });
    expect(calls).toEqual(["play:harbour-lanterns:loop"]);
    for (const levels of [{ enabled: false }, { master: 0 }, { music: 0 }]) {
      const muted = setup(levels);
      muted.audio.apply({ fadeInSeconds: 0, fadeOutSeconds: 0, kind: "playMusic", loop: true,
        track: catalog("music:harbour-lanterns"), volume: 1 });
      expect(muted.calls).toEqual([]);
    }
  });

  it("stopMusic fades out, stops and restores the cue gain; it does nothing while no music plays", () => {
    const playing = setup({}, true);
    playing.audio.apply({ fadeOutSeconds: 2, kind: "stopMusic" });
    playing.advance(1000);
    expect(playing.gain()).toBeCloseTo(.5);
    playing.advance(1000);
    expect(playing.calls).toEqual(["stop"]);
    expect(playing.gain()).toBe(1);
    const idle = setup();
    idle.audio.apply({ fadeOutSeconds: 2, kind: "stopMusic" });
    expect(idle.calls).toEqual([]);
  });
});
