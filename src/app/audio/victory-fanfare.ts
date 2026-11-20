import { settingsStorage } from "../settings/graphics-settings";
import { audioLevels } from "./audio-levels";

/**
 * Original victory fanfare for a won colony or adventure, synthesised on the fly (brass voices,
 * a timpani roll and a short hall reverb). No sampled or copyrighted music is used.
 */
export interface FanfareNote {
  /** Start, in seconds from the beginning of the fanfare. */
  at: number;
  duration: number;
  frequency: number;
  /** Lead trumpet or a lower harmony voice. */
  voice: "lead" | "harmony";
}

const NOTE = { C4: 261.63, E4: 329.63, G4: 392, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99 };
const FINAL_AT = 1.8;
const FINAL_HOLD = 1.3;
const REVERB_SECONDS = 1.6;

const lead = (at: number, duration: number, frequency: number): FanfareNote =>
  ({ at, duration, frequency, voice: "lead" });
const harmony = (at: number, duration: number, frequency: number): FanfareNote =>
  ({ at, duration, frequency, voice: "harmony" });

/** About 3 s: a triplet call, a rising answer and a held major chord. */
export const VICTORY_FANFARE: readonly FanfareNote[] = [
  lead(0, .1, NOTE.G4), lead(.12, .1, NOTE.G4), lead(.24, .1, NOTE.G4),
  lead(.36, .36, NOTE.C5), harmony(.36, .36, NOTE.E4),
  lead(.76, .16, NOTE.G4), lead(.94, .16, NOTE.C5),
  lead(1.12, .36, NOTE.E5), harmony(1.12, .36, NOTE.G4),
  lead(1.52, .12, NOTE.D5), lead(1.66, .12, NOTE.E5),
  lead(FINAL_AT, FINAL_HOLD, NOTE.G5), harmony(FINAL_AT, FINAL_HOLD, NOTE.E5),
  harmony(FINAL_AT, FINAL_HOLD, NOTE.C5), harmony(FINAL_AT, FINAL_HOLD, NOTE.C4)
];
/** Timpani strokes under the first long note and the final chord. */
export const VICTORY_TIMPANI: readonly number[] = [.36, FINAL_AT];

export const fanfareLength = (notes: readonly FanfareNote[]) =>
  Math.max(...notes.map(note => note.at + note.duration));

const createHallReverb = (context: BaseAudioContext) => {
  const length = Math.round(context.sampleRate * REVERB_SECONDS);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  }
  const reverb = context.createConvolver();
  reverb.buffer = impulse;
  return reverb;
};

/** One brass note: two detuned saws through a lowpass that blooms open on the attack. */
const playBrassNote = (context: BaseAudioContext, output: AudioNode, start: number, note: FanfareNote) => {
  const level = note.voice === "lead" ? .32 : .2;
  const end = start + note.duration;
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0, start);
  envelope.gain.linearRampToValueAtTime(level, start + .03);
  envelope.gain.setTargetAtTime(level * .75, start + .05, .08);
  envelope.gain.setTargetAtTime(0, end, .06);
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(note.frequency * 1.5, start);
  filter.frequency.exponentialRampToValueAtTime(note.frequency * 6, start + .06);
  filter.frequency.setTargetAtTime(note.frequency * 4, start + .08, .1);
  filter.connect(envelope).connect(output);
  const oscillators = [-6, 6].map(detune => {
    const oscillator = context.createOscillator();
    oscillator.type = "sawtooth";
    oscillator.frequency.value = note.frequency;
    oscillator.detune.value = detune;
    oscillator.connect(filter);
    oscillator.start(start);
    oscillator.stop(end + .4);
    return oscillator;
  });
  if (note.duration > .5) addVibrato(context, oscillators, start + .25, end + .4);
};

const addVibrato = (context: BaseAudioContext, oscillators: OscillatorNode[], start: number, end: number) => {
  const lfo = context.createOscillator(), depth = context.createGain();
  lfo.frequency.value = 5.5;
  depth.gain.setValueAtTime(0, start);
  depth.gain.linearRampToValueAtTime(7, start + .3);
  lfo.connect(depth);
  for (const oscillator of oscillators) depth.connect(oscillator.detune);
  lfo.start(start);
  lfo.stop(end);
};

const playTimpani = (context: BaseAudioContext, output: AudioNode, start: number) => {
  const drum = context.createOscillator(), envelope = context.createGain();
  drum.frequency.setValueAtTime(110, start);
  drum.frequency.exponentialRampToValueAtTime(65, start + .5);
  envelope.gain.setValueAtTime(.5, start);
  envelope.gain.exponentialRampToValueAtTime(.001, start + .9);
  drum.connect(envelope).connect(output);
  drum.start(start);
  drum.stop(start + .9);
};

const createOutput = (context: BaseAudioContext, volume: number) => {
  const master = context.createGain(), compressor = context.createDynamicsCompressor();
  master.gain.value = .5 * volume;
  const reverb = createHallReverb(context), wet = context.createGain();
  wet.gain.value = .25;
  master.connect(compressor).connect(context.destination);
  master.connect(reverb).connect(wet).connect(compressor);
  return master;
};

/** Schedules the whole fanfare from `start`; also used to render it offline for review. */
export const scheduleVictoryFanfare = (context: BaseAudioContext, start: number, volume: number) => {
  const output = createOutput(context, volume);
  for (const note of VICTORY_FANFARE) playBrassNote(context, output, start + note.at, note);
  for (const at of VICTORY_TIMPANI) playTimpani(context, output, start + at);
};

let fanfareContext: AudioContext | undefined;

/** Plays the fanfare once when sound is on; silently skipped where audio is unavailable. */
export const playVictoryFanfare = () => {
  if (!settingsStorage.readSound() || typeof AudioContext === "undefined") return;
  fanfareContext ??= new AudioContext();
  const context = fanfareContext;
  void context.resume().catch(() => {});
  scheduleVictoryFanfare(context, context.currentTime + .05,
    settingsStorage.readEnvironmentVolume() * audioLevels.getSnapshot().master);
};
