import {
  bandpass,
  forEachEvent,
  highpass,
  lowpass,
  makeLoop,
  mixInto,
  normalize,
  pinkNoise,
  randomLog,
  randomRange,
  renderBubble,
  renderBurst,
  type SynthInput,
  whiteNoise} from "./dsp";

const LOOP_FADE_SECONDS = 1;
const RAIN_LOOP_SECONDS = 7;

const loopLength = (rate: number) => Math.round((RAIN_LOOP_SECONDS + LOOP_FADE_SECONDS) * rate);

/** Rain on the ground: a broad hiss with a fine patter of drops, some landing in puddles. */
export const renderRainHiss = (input: SynthInput) => {
  const { random, rate } = input;
  const length = loopLength(rate);
  const samples = highpass(whiteNoise(random, length), 1400, rate);
  lowpass(samples, 9000, rate);
  const body = lowpass(pinkNoise(random, length), 600, rate);
  for (let index = 0; index < length; index += 1) samples[index]! += body[index]! * 0.6;
  forEachEvent(random, length / rate, 320, (time) => {
    const burst = renderBurst(input, 0.004, randomLog(random, 2500, 7000), 1.2, 0.0012);
    mixInto(samples, burst, Math.round(time * rate), randomRange(random, 0.2, 1.2));
  });
  forEachEvent(random, length / rate, 9, (time) => {
    const plink = renderBubble(rate, randomLog(random, 1400, 3800), 0.03, 0.8);
    mixInto(samples, plink, Math.round(time * rate), randomRange(random, 0.05, 0.18));
  });
  return normalize(makeLoop(samples, LOOP_FADE_SECONDS, rate), 0.16);
};

/** Rain on leaves: a dense, mid pitched tapping of drops on the canopy above. */
export const renderRainOnLeaves = (input: SynthInput) => {
  const { random, rate } = input;
  const length = loopLength(rate);
  const samples = bandpass(pinkNoise(random, length), () => 2200, 0.6, rate);
  for (let index = 0; index < length; index += 1) samples[index]! *= 0.35;
  forEachEvent(random, length / rate, 650, (time) => {
    const burst = renderBurst(input, 0.008, randomLog(random, 1200, 3600), 2.5, 0.0025);
    mixInto(samples, burst, Math.round(time * rate), randomRange(random, 0.15, 1));
  });
  highpass(samples, 500, rate);
  return normalize(makeLoop(samples, LOOP_FADE_SECONDS, rate), 0.14);
};
