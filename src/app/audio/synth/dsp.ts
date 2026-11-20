import type { Random } from "../../../shared/world/rng";

/**
 * Small offline DSP toolkit: every ambient sound of the island is computed from noise and
 * oscillators into plain Float32Arrays (no recorded or downloaded audio). Pure and deterministic
 * per seed, so the same code renders WAV files in tests and tools.
 */
export interface SynthInput {
  random: Random;
  /** Samples per second of the rendered buffer. */
  rate: number;
}

const TAU = Math.PI * 2;

export const createSamples = (seconds: number, rate: number) =>
  new Float32Array(Math.max(1, Math.round(seconds * rate)));

export const randomRange = (random: Random, min: number, max: number) =>
  min + (max - min) * random();

/** Log uniform pick: musical intervals and filter frequencies feel evenly spread. */
export const randomLog = (random: Random, min: number, max: number) =>
  min * Math.pow(max / min, random());

export const whiteNoise = (random: Random, length: number) => {
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) samples[index] = random() * 2 - 1;
  return samples;
};

/** Pink noise (-3 dB per octave, Paul Kellet's economy filter). */
export const pinkNoise = (random: Random, length: number) => {
  const samples = new Float32Array(length);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let index = 0; index < length; index += 1) {
    const white = random() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    samples[index] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
  }
  return samples;
};

/** Brown (red) noise: leaky integrated white noise, the rumble of surf. */
export const brownNoise = (random: Random, length: number) => {
  const samples = new Float32Array(length);
  let value = 0;
  for (let index = 0; index < length; index += 1) {
    value = value * 0.996 + (random() * 2 - 1) * 0.06;
    samples[index] = value;
  }
  return samples;
};

const onePoleCoefficient = (cutoff: number, rate: number) => 1 - Math.exp((-TAU * cutoff) / rate);

/** One pole low pass, in place. */
export const lowpass = (samples: Float32Array, cutoff: number, rate: number) => {
  const amount = onePoleCoefficient(cutoff, rate);
  let state = 0;
  for (let index = 0; index < samples.length; index += 1) {
    state += (samples[index]! - state) * amount;
    samples[index] = state;
  }
  return samples;
};

/** One pole high pass, in place. */
export const highpass = (samples: Float32Array, cutoff: number, rate: number) => {
  const amount = onePoleCoefficient(cutoff, rate);
  let state = 0;
  for (let index = 0; index < samples.length; index += 1) {
    state += (samples[index]! - state) * amount;
    samples[index] = samples[index]! - state;
  }
  return samples;
};

/** State of a state variable filter (topology preserving, stable under fast cutoff changes). */
export interface Svf {
  a1: number;
  a2: number;
  a3: number;
  band: number;
  high: number;
  ic1: number;
  ic2: number;
  k: number;
  low: number;
}

const createSvf = (): Svf => ({
  a1: 0,
  a2: 0,
  a3: 0,
  band: 0,
  high: 0,
  ic1: 0,
  ic2: 0,
  k: 1,
  low: 0
});

const tuneSvf = (svf: Svf, cutoff: number, q: number, rate: number) => {
  const g = Math.tan((Math.PI * Math.min(cutoff, rate * 0.45)) / rate);
  svf.k = 1 / q;
  svf.a1 = 1 / (1 + g * (g + svf.k));
  svf.a2 = g * svf.a1;
  svf.a3 = g * svf.a2;
};

/** One sample through the filter; read `low`, `band` or `high` afterwards. */
const stepSvf = (svf: Svf, input: number) => {
  const v3 = input - svf.ic2;
  const v1 = svf.a1 * svf.ic1 + svf.a2 * v3;
  const v2 = svf.ic2 + svf.a2 * svf.ic1 + svf.a3 * v3;
  svf.ic1 = 2 * v1 - svf.ic1;
  svf.ic2 = 2 * v2 - svf.ic2;
  svf.low = v2;
  svf.band = v1;
  svf.high = input - svf.k * v1 - v2;
};

/** Cutoff changes are applied every block of samples (tan per sample is not needed). */
const SVF_BLOCK = 32;

/** Band pass in place; `cutoffAt` (seconds -> Hz) may sweep the centre over time. */
export const bandpass = (
  samples: Float32Array,
  cutoffAt: (time: number) => number,
  q: number,
  rate: number
) => {
  const svf = createSvf();
  for (let index = 0; index < samples.length; index += 1) {
    if (index % SVF_BLOCK === 0) tuneSvf(svf, cutoffAt(index / rate), q, rate);
    stepSvf(svf, samples[index]!);
    samples[index] = svf.band;
  }
  return samples;
};

/**
 * Smooth random control curve 0..1: random points `perSecond` times a second, eased between.
 * Wrapping to the first point makes it loop seamlessly.
 */
export const smoothRandomCurve = (
  random: Random,
  length: number,
  rate: number,
  perSecond: number
) => {
  const points = Math.max(2, Math.round((length / rate) * perSecond));
  const values = Array.from({ length: points }, () => random());
  const curve = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = (index / length) * points;
    const point = Math.floor(position);
    const t = position - point;
    const eased = t * t * (3 - 2 * t);
    const from = values[point % points]!;
    const to = values[(point + 1) % points]!;
    curve[index] = from + (to - from) * eased;
  }
  return curve;
};

export const multiply = (samples: Float32Array, curve: (index: number) => number) => {
  for (let index = 0; index < samples.length; index += 1) samples[index]! *= curve(index);
  return samples;
};

/** Adds `source` into `target` at `offset` (clipped at the end) with a gain. */
export const mixInto = (target: Float32Array, source: Float32Array, offset: number, gain = 1) => {
  const end = Math.min(target.length, offset + source.length);
  for (let index = Math.max(0, offset); index < end; index += 1) {
    target[index]! += source[index - offset]! * gain;
  }
  return target;
};

/** Adds `source` into a looping `target` at `offset`: what runs past the end wraps to the start. */
export const mixIntoLoop = (
  target: Float32Array,
  source: Float32Array,
  offset: number,
  gain = 1
) => {
  for (let index = 0; index < source.length; index += 1) {
    target[(offset + index) % target.length]! += source[index]! * gain;
  }
  return target;
};

/** Raised cosine window 0..1..0 over 0..1 with separate attack and release shares. */
export const windowShape = (t: number, attack: number, release: number) => {
  if (t <= 0 || t >= 1) return 0;
  if (t < attack) return 0.5 - 0.5 * Math.cos((Math.PI * t) / attack);
  if (t > 1 - release) return 0.5 - 0.5 * Math.cos((Math.PI * (1 - t)) / release);
  return 1;
};

export interface ToneShape {
  /** Envelope 0..1 over the normalised time 0..1. */
  amplitudeAt: (t: number) => number;
  /** Frequency in Hz over the normalised time 0..1. */
  frequencyAt: (t: number) => number;
  /** Relative strengths of harmonics 1, 2, 3, ... (default: a pure sine). */
  harmonics?: readonly number[];
  seconds: number;
}

/** Renders a gliding tone (sum of harmonics, phase accumulated so sweeps stay smooth). */
export const renderTone = (shape: ToneShape, rate: number) => {
  const samples = createSamples(shape.seconds, rate);
  const harmonics = shape.harmonics ?? [1];
  let phase = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const t = index / samples.length;
    phase += (TAU * shape.frequencyAt(t)) / rate;
    let value = 0;
    for (let harmonic = 0; harmonic < harmonics.length; harmonic += 1) {
      value += Math.sin(phase * (harmonic + 1)) * harmonics[harmonic]!;
    }
    samples[index] = value * shape.amplitudeAt(t);
  }
  return samples;
};

/** Short decaying noise burst through a band pass (clicks, ticks, splashes, droplets). */
export const renderBurst = (
  input: SynthInput,
  seconds: number,
  centre: number,
  q: number,
  decaySeconds: number
) => {
  const { random, rate } = input;
  const samples = whiteNoise(random, Math.max(4, Math.round(seconds * rate)));
  bandpass(samples, () => centre, q, rate);
  return multiply(samples, (index) => Math.exp(-index / rate / decaySeconds));
};

/**
 * A water bubble (after Minnaert / Farnell): a sine that rises in pitch while it decays.
 * The tiny attack ramp avoids a click.
 */
export const renderBubble = (rate: number, frequency: number, seconds: number, rise: number) =>
  renderTone(
    {
      amplitudeAt: (t) => Math.min(1, t * 40) * Math.exp(-t * 5),
      frequencyAt: (t) => frequency * (1 + rise * t),
      seconds
    },
    rate
  );

/** Exponential waiting times of a Poisson process: `perSecond` events on average. */
export const forEachEvent = (
  random: Random,
  seconds: number,
  perSecond: number,
  visit: (time: number) => void
) => {
  let time = -Math.log(1 - random()) / perSecond;
  while (time < seconds) {
    visit(time);
    time += -Math.log(1 - random()) / perSecond;
  }
};

/**
 * Seamless loop: the `fadeSeconds` tail is crossfaded (equal power) into the head and cut off,
 * so the buffer repeats without a click or a gap.
 */
export const makeLoop = (samples: Float32Array, fadeSeconds: number, rate: number) => {
  const fade = Math.min(Math.round(fadeSeconds * rate), Math.floor(samples.length / 3));
  const length = samples.length - fade;
  const loop = samples.slice(0, length);
  for (let index = 0; index < fade; index += 1) {
    const t = index / fade;
    const fadeIn = Math.sin((t * Math.PI) / 2);
    const fadeOut = Math.cos((t * Math.PI) / 2);
    loop[index] = samples[index]! * fadeIn + samples[length + index]! * fadeOut;
  }
  return loop;
};

export const measureRms = (samples: Float32Array) => {
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) sum += samples[index]! ** 2;
  return Math.sqrt(sum / samples.length);
};

export const measurePeak = (samples: Float32Array) => {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1)
    peak = Math.max(peak, Math.abs(samples[index]!));
  return peak;
};

/** Linear below the knee, then a tanh curve that approaches `ceiling` (continuous slope). */
const softLimit = (value: number, ceiling: number) => {
  const knee = ceiling * 0.7;
  const magnitude = Math.abs(value);
  if (magnitude <= knee) return value;
  const range = ceiling - knee;
  return Math.sign(value) * (knee + range * Math.tanh((magnitude - knee) / range));
};

/**
 * Scales to a target loudness (RMS), then soft limits the peaks, so every bed has a comparable
 * level and none clips.
 */
export const normalize = (samples: Float32Array, targetRms: number, ceiling = 0.95) => {
  const rms = measureRms(samples);
  const gain = rms > 0 ? targetRms / rms : 0;
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = softLimit(samples[index]! * gain, ceiling);
  }
  return samples;
};

/** Scales so the loudest sample is `peak` (one-shot calls). */
export const normalizePeak = (samples: Float32Array, peak: number) => {
  const current = measurePeak(samples);
  if (current === 0) return samples;
  for (let index = 0; index < samples.length; index += 1) samples[index]! *= peak / current;
  return samples;
};

/** Cuts the silent tail of a one-shot (below `threshold`), keeping a short release. */
export const trimTail = (samples: Float32Array, rate: number, threshold = 0.002) => {
  let end = samples.length;
  while (end > 1 && Math.abs(samples[end - 1]!) < threshold) end -= 1;
  return samples.slice(0, Math.min(samples.length, end + Math.round(rate * 0.01)));
};
