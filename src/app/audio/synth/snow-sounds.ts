import {
  bandpass,
  brownNoise,
  forEachEvent,
  lowpass,
  makeLoop,
  mixInto,
  normalize,
  pinkNoise,
  randomLog,
  randomRange,
  renderBurst,
  smoothRandomCurve,
  type SynthInput
} from "./dsp";

const LOOP_FADE_SECONDS = 1.5;
const SNOW_LOOP_SECONDS = 11;
/** Snowfall is nearly silent: the bed sits well below the rain hiss (RMS 0.16). */
const SNOW_LEVEL = 0.05;

/** A soft creak of a snow-laden branch: a low, slowly decaying band of noise. */
const renderCreak = (input: SynthInput) =>
  renderBurst(input, 0.35, randomLog(input.random, 160, 420), 9, 0.12);

/** Snow settling (a small slide off a branch): a muffled, short puff. */
const renderSettle = (input: SynthInput) => {
  const puff = renderBurst(input, 0.25, randomLog(input.random, 700, 1500), 1.4, 0.07);
  return lowpass(puff, 1800, input.rate);
};

/**
 * Snowfall bed: muffled wind (low brown noise swelling slowly, a faint airy band over it) with
 * an occasional soft creak and settling snow; very quiet, snow swallows the sound.
 */
export const renderSnowfall = (input: SynthInput) => {
  const { random, rate } = input;
  const length = Math.round((SNOW_LOOP_SECONDS + LOOP_FADE_SECONDS) * rate);
  const samples = lowpass(brownNoise(random, length), 320, rate);
  const swell = smoothRandomCurve(random, length, rate, 0.18);
  const air = bandpass(pinkNoise(random, length), () => 900, 0.5, rate);
  for (let index = 0; index < length; index += 1) {
    const gust = 0.45 + swell[index]! * 0.55;
    samples[index] = samples[index]! * gust + air[index]! * 0.06 * gust;
  }
  forEachEvent(random, length / rate, 0.35, (time) => {
    mixInto(samples, renderCreak(input), Math.round(time * rate), randomRange(random, 0.05, 0.12));
  });
  forEachEvent(random, length / rate, 0.6, (time) => {
    mixInto(samples, renderSettle(input), Math.round(time * rate), randomRange(random, 0.03, 0.08));
  });
  return normalize(makeLoop(samples, LOOP_FADE_SECONDS, rate), SNOW_LEVEL);
};
