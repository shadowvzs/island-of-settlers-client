import { CREATURE_CUE_GAIN, CUE_START_DELAY_SECONDS } from "./constants";
import { CREATURE_SOUND_KINDS, type CreatureSoundKind, renderCall, SYNTH_RATE } from "./synth/sound-bank";
import { scheduleThunder } from "./synth/thunder";
import { scheduleVictoryFanfare } from "./victory-fanfare";

/**
 * The audio cue registry (catalog README, "References": `cue:<group>.<name>`): sounds the client synthesizes
 * instead of shipping a file. `sound:*` catalog entries name them; a test keeps both sides equal.
 */
type CuePlayer = (context: AudioContext, gain: number) => void;

const creatureBuffers = new Map<CreatureSoundKind, Float32Array>();

const playCreatureCall = (kind: CreatureSoundKind): CuePlayer => (context, gain) => {
  let samples = creatureBuffers.get(kind);
  if (!samples) {
    samples = renderCall(kind);
    creatureBuffers.set(kind, samples);
  }
  const buffer = context.createBuffer(1, samples.length, SYNTH_RATE);
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const source = context.createBufferSource(), output = context.createGain();
  source.buffer = buffer;
  output.gain.value = gain * CREATURE_CUE_GAIN;
  source.connect(output).connect(context.destination);
  source.onended = () => { source.disconnect(); output.disconnect(); };
  source.start(context.currentTime + CUE_START_DELAY_SECONDS);
};

const CUE_PLAYERS: Readonly<Record<string, CuePlayer>> = {
  "cue:fanfare.victory": (context, gain) =>
    scheduleVictoryFanfare(context, context.currentTime + CUE_START_DELAY_SECONDS, gain),
  "cue:weather.thunder": (context, gain) => scheduleThunder(context, context.currentTime + CUE_START_DELAY_SECONDS, gain),
  ...Object.fromEntries(CREATURE_SOUND_KINDS.map(kind => [`cue:creature.${kind}`, playCreatureCall(kind)]))
};

/** Every registered cue id. */
export const AUDIO_CUE_IDS: readonly string[] = Object.freeze(Object.keys(CUE_PLAYERS).sort());

/**
 * Plays cues on one lazily created audio context (browsers start it only after a user gesture; a cue before
 * that is silently lost, like every other sound).
 */
export const createAudioCuePlayer = (createContext: () => AudioContext | null = () =>
  (typeof AudioContext === "undefined" ? null : new AudioContext())) => {
  let context: AudioContext | null = null;
  return {
    dispose: () => {
      void context?.close().catch(() => undefined);
      context = null;
    },
    /** False for an unknown cue or where audio is unavailable. */
    play: (cueId: string, gain: number) => {
      const player = CUE_PLAYERS[cueId];
      context ??= player ? createContext() : null;
      if (!player || !context) return false;
      void context.resume().catch(() => undefined);
      player(context, gain);
      return true;
    }
  };
};

export type AudioCuePlayer = ReturnType<typeof createAudioCuePlayer>;
