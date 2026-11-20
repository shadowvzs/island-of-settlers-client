import type { AudioRef } from "../../../../island-of-settlers-shared/src/script/audio";
import type { ScriptAudioEffect } from "../../../../island-of-settlers-shared/src/script/engine/ui-effects";
import type { AudioCuePlayer } from "./audio-cues";
import { type AudioUploadLookup, resolveAudioRef } from "./audio-refs";
import { MS_PER_SECOND, SCRIPT_SOUND_VOICE_LIMIT } from "./constants";
import type { MusicCueFader, MusicCueTarget } from "./music-cue-fader";

/** The player's audio settings a script effect obeys. */
export interface ScriptAudioLevels {
  /** Effect / environment category volume 0..1. */
  effects: number;
  /** Settings > Sounds on / off. */
  enabled: boolean;
  master: number;
  /** Music category volume 0..1 (the music player applies it; 0 means the player wants no music). */
  music: number;
}

export interface ScriptMusicTrack {
  id: string;
  name: string;
  url: string;
}

/** The parts of the page's music player a script drives. */
export interface ScriptMusicTarget extends MusicCueTarget {
  playCueTrack: (track: ScriptMusicTrack, loop: boolean) => boolean;
}

/** The parts of an audio element a sound voice uses (a fake one serves the tests). */
export type SoundVoice = Pick<HTMLAudioElement, "addEventListener" | "pause" | "play" | "volume">;

export interface ScriptAudioOptions {
  createVoice?: (url: string) => SoundVoice;
  cues: Pick<AudioCuePlayer, "play">;
  fader: Pick<MusicCueFader, "change">;
  levels: () => ScriptAudioLevels;
  log?: (line: string) => void;
  /** The page's music player, if any. */
  music: () => ScriptMusicTarget | null;
  uploads: AudioUploadLookup;
}

const describeRef = (ref: AudioRef) => (ref.kind === "catalog" ? ref.id : `upload ${ref.assetId}`);

/**
 * Plays the map script's audio effects (owner 2026-11-12) on any island: sounds through a few short-lived voices
 * or the synthesized cue player, music through the page's music player with a fade. Presentation only: nothing
 * here is saved or recorded, and every effect obeys Settings > Sounds (off, master, effect and music volume).
 */
export const createScriptAudio = (options: ScriptAudioOptions) => {
  const createVoice = options.createVoice ?? (url => new Audio(url));
  const voices = new Set<SoundVoice>();
  const log = options.log ?? (() => undefined);

  const effectGain = (volume: number) => {
    const { effects, enabled, master } = options.levels();
    return enabled ? volume * effects * master : 0;
  };

  const playFile = (url: string, gain: number) => {
    if (voices.size >= SCRIPT_SOUND_VOICE_LIMIT) return log("playSound dropped: too many sounds at once");
    const voice = createVoice(url);
    const release = () => voices.delete(voice);
    voice.volume = Math.min(1, gain);
    voice.addEventListener("ended", release);
    voice.addEventListener("error", release);
    voices.add(voice);
    void voice.play().catch(release);
  };

  const playSound = (effect: Extract<ScriptAudioEffect, { kind: "playSound" }>) => {
    const gain = effectGain(effect.volume);
    if (gain <= 0) return;
    const sound = resolveAudioRef(effect.sound, "sound", options.uploads);
    if (!sound) return log(`playSound ${describeRef(effect.sound)}: unknown sound`);
    if (sound.kind === "cue") options.cues.play(sound.cue, gain);
    else playFile(sound.url, gain);
  };

  const musicWanted = () => {
    const { enabled, master, music } = options.levels();
    return enabled && master > 0 && music > 0;
  };

  const playMusic = (effect: Extract<ScriptAudioEffect, { kind: "playMusic" }>) => {
    const target = options.music();
    if (!target || !musicWanted()) return;
    const track = resolveAudioRef(effect.track, "music", options.uploads);
    if (!track || track.kind !== "file") return log(`playMusic ${describeRef(effect.track)}: unknown track`);
    options.fader.change(target, {
      fadeInMs: effect.fadeInSeconds * MS_PER_SECOND,
      fadeOutMs: effect.fadeOutSeconds * MS_PER_SECOND,
      gain: effect.volume,
      start: () => target.playCueTrack(track, effect.loop)
    });
  };

  const stopMusic = (effect: Extract<ScriptAudioEffect, { kind: "stopMusic" }>) => {
    const target = options.music();
    if (!target?.playing()) return;
    options.fader.change(target, { fadeInMs: 0, fadeOutMs: effect.fadeOutSeconds * MS_PER_SECOND, gain: 1, start: null });
  };

  return {
    apply: (effect: ScriptAudioEffect) => {
      if (effect.kind === "playSound") return playSound(effect);
      if (effect.kind === "playMusic") return playMusic(effect);
      return stopMusic(effect);
    },
    dispose: () => {
      for (const voice of voices) voice.pause();
      voices.clear();
    }
  };
};

export type ScriptAudio = ReturnType<typeof createScriptAudio>;
