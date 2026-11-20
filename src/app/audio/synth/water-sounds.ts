import {
  bandpass,
  brownNoise,
  createSamples,
  forEachEvent,
  highpass,
  lowpass,
  makeLoop,
  mixInto,
  mixIntoLoop,
  multiply,
  normalize,
  pinkNoise,
  randomLog,
  randomRange,
  renderBubble,
  smoothRandomCurve,
  type SynthInput
} from "./dsp";

const LOOP_FADE_SECONDS = 1.5;

/** Swell period of the sea bed: the loop holds a whole number of swells. */
const SWELL_SECONDS = 8;
const SWELL_LOOP_SECONDS = SWELL_SECONDS * 3;

/**
 * Open sea: a deep rumble that slowly swells and ebbs, its brightness rising with each swell
 * (the far surf as a whole).
 */
export const renderSeaSwell = ({ random, rate }: SynthInput) => {
  const length = Math.round((SWELL_LOOP_SECONDS + LOOP_FADE_SECONDS) * rate);
  const rumble = brownNoise(random, length);
  const wash = pinkNoise(random, length);
  const drift = smoothRandomCurve(random, length, rate, 0.5);
  const swellAt = (time: number) =>
    0.5 + 0.5 * Math.sin((2 * Math.PI * time) / SWELL_SECONDS + 1.2 * drift[0]!);
  bandpass(wash, (time) => 350 + 700 * swellAt(time) ** 2, 0.6, rate);
  const samples = createSamples(length / rate, rate);
  for (let index = 0; index < length; index += 1) {
    const swell = swellAt(index / rate) * (0.75 + 0.25 * drift[index]!);
    samples[index] = rumble[index]! * (0.55 + 0.45 * swell) + wash[index]! * swell ** 1.6 * 0.9;
  }
  highpass(samples, 35, rate);
  return normalize(makeLoop(samples, LOOP_FADE_SECONDS, rate), 0.2);
};

const BREAK_LOOP_SECONDS = 21;

/** One breaking wave: a rising rumble, the crash, then the hissing wash running up the sand. */
const renderBreaker = (input: SynthInput, strength: number) => {
  const { random, rate } = input;
  const seconds = 6.5;
  const rise = randomRange(random, 0.8, 1.4);
  const length = Math.round(seconds * rate);
  const crash = pinkNoise(random, length);
  const sweepFrom = randomRange(random, 1800, 2600);
  bandpass(crash, (time) => 500 + sweepFrom * Math.exp(-Math.max(0, time - rise) * 1.6), 0.7, rate);
  const fizz = highpass(pinkNoise(random, length), 1600, rate);
  const envelopeAt = (time: number) => {
    if (time < rise) return 0.25 * (time / rise) ** 2;
    const after = time - rise;
    return Math.min(1, after * 18) * (0.25 + 0.75 * Math.exp(-after * 1.3));
  };
  const washAt = (time: number) => {
    const after = time - rise - 0.3;
    if (after < 0) return 0;
    return Math.min(1, after * 3) * Math.exp(-after * 0.75);
  };
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const time = index / rate;
    const fade = Math.min(1, (seconds - time) * 2);
    samples[index] =
      (crash[index]! * envelopeAt(time) + fizz[index]! * washAt(time) * 0.6) * strength * fade;
  }
  return samples;
};

/**
 * Surf at the shoreline: three to four breakers at irregular times over a soft wash, each with
 * its own strength and colour, so the rhythm does not feel mechanical.
 */
export const renderSeaBreakers = (input: SynthInput) => {
  const { random, rate } = input;
  const bedLength = Math.round((BREAK_LOOP_SECONDS + LOOP_FADE_SECONDS) * rate);
  const bed = lowpass(pinkNoise(random, bedLength), 900, rate);
  const samples = multiply(makeLoop(bed, LOOP_FADE_SECONDS, rate), () => 0.25);
  let time = randomRange(random, 0, 1.5);
  while (time < BREAK_LOOP_SECONDS - 3) {
    const breaker = renderBreaker(input, randomRange(random, 0.55, 1));
    mixIntoLoop(samples, breaker, Math.round(time * rate));
    time += randomRange(random, 4.6, 7.4);
  }
  return normalize(highpass(samples, 60, rate), 0.2);
};

const RIVER_LOOP_SECONDS = 9;

/** Bubbles per second of the stream: dense chatter with clusters (gurgles). */
const BUBBLES_PER_SECOND = 55;

/**
 * Brook: a band passed noise bed (the rush) plus many rising pitch bubbles in clusters (the
 * babble), each bubble with its own size (pitch) and life.
 */
export const renderRiver = (input: SynthInput) => {
  const { random, rate } = input;
  const totalSeconds = RIVER_LOOP_SECONDS + LOOP_FADE_SECONDS;
  const length = Math.round(totalSeconds * rate);
  const surge = smoothRandomCurve(random, length, rate, 1.6);
  const samples = bandpass(
    pinkNoise(random, length),
    (time) => 700 + 500 * Math.sin(time),
    0.5,
    rate
  );
  multiply(samples, (index) => 0.35 + 0.25 * surge[index]!);
  forEachEvent(random, totalSeconds, BUBBLES_PER_SECOND, (time) => {
    const index = Math.round(time * rate);
    const gurgle = surge[Math.min(length - 1, index)]!;
    const frequency = randomLog(random, 260, 1500) * (1.15 - gurgle * 0.3);
    const bubble = renderBubble(
      rate,
      frequency,
      randomRange(random, 0.012, 0.05),
      randomRange(random, 0.3, 1.4)
    );
    mixInto(samples, bubble, index, randomRange(random, 0.2, 1) * (0.5 + gurgle));
  });
  highpass(samples, 120, rate);
  return normalize(makeLoop(samples, LOOP_FADE_SECONDS, rate), 0.17);
};
