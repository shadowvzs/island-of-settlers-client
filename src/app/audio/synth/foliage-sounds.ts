import {
  bandpass,
  forEachEvent,
  highpass,
  makeLoop,
  mixInto,
  multiply,
  normalize,
  pinkNoise,
  randomRange,
  renderBurst,
  smoothRandomCurve,
  type SynthInput,
  whiteNoise} from "./dsp";

const LOOP_FADE_SECONDS = 1.2;
const LEAF_LOOP_SECONDS = 11;

const loopLength = (rate: number) => Math.round((LEAF_LOOP_SECONDS + LOOP_FADE_SECONDS) * rate);

/** Scatters tiny noise ticks (leaves touching), denser and louder while `activity` is high. */
const addLeafTicks = (
  input: SynthInput,
  samples: Float32Array,
  activity: Float32Array,
  tick: { centre: number; perSecond: number; q: number; seconds: number }
) => {
  const { random, rate } = input;
  forEachEvent(random, samples.length / rate, tick.perSecond, (time) => {
    const index = Math.round(time * rate);
    const level = activity[Math.min(activity.length - 1, index)]!;
    if (random() > level) return;
    const centre = tick.centre * randomRange(random, 0.7, 1.4);
    const burst = renderBurst(input, tick.seconds, centre, tick.q, tick.seconds / 3);
    mixInto(samples, burst, index, randomRange(random, 0.3, 1) * level);
  });
};

/**
 * Broadleaf (oak) crowns: a soft, mid high rustle that swells with small gusts, sprinkled with
 * leaf ticks.
 */
export const renderBroadleafRustle = (input: SynthInput) => {
  const { random, rate } = input;
  const length = loopLength(rate);
  const gust = smoothRandomCurve(random, length, rate, 0.7);
  const flutter = smoothRandomCurve(random, length, rate, 6);
  const samples = pinkNoise(random, length);
  bandpass(
    samples,
    (time) => 1800 + 1600 * gust[Math.min(length - 1, Math.round(time * rate))]!,
    0.8,
    rate
  );
  multiply(
    samples,
    (index) => (0.25 + 0.75 * gust[index]! ** 1.5) * (0.75 + 0.25 * flutter[index]!)
  );
  addLeafTicks(input, samples, gust, { centre: 3200, perSecond: 260, q: 1.6, seconds: 0.006 });
  highpass(samples, 400, rate);
  return normalize(makeLoop(samples, LOOP_FADE_SECONDS, rate), 0.13);
};

/** Pine crowns: an airy, smooth, high whoosh (wind through needles), almost no ticks. */
export const renderNeedleHiss = (input: SynthInput) => {
  const { random, rate } = input;
  const length = loopLength(rate);
  const gust = smoothRandomCurve(random, length, rate, 0.45);
  const samples = whiteNoise(random, length);
  bandpass(
    samples,
    (time) => 4200 + 2600 * gust[Math.min(length - 1, Math.round(time * rate))]!,
    0.55,
    rate
  );
  const body = bandpass(pinkNoise(random, length), () => 900, 0.7, rate);
  for (let index = 0; index < length; index += 1) {
    const swell = 0.2 + 0.8 * gust[index]! ** 2;
    samples[index] = (samples[index]! * 0.8 + body[index]! * 0.35) * swell;
  }
  highpass(samples, 300, rate);
  return normalize(makeLoop(samples, LOOP_FADE_SECONDS, rate), 0.12);
};

/** One frond flap: a quick cluster of dry knocks (stiff leaflets hitting each other). */
const addFrondFlap = (
  input: SynthInput,
  samples: Float32Array,
  start: number,
  strength: number
) => {
  const { random, rate } = input;
  const knocks = 3 + Math.floor(random() * 6);
  let time = start;
  for (let knock = 0; knock < knocks; knock += 1) {
    const centre = randomRange(random, 1100, 2800);
    const burst = renderBurst(input, 0.03, centre, 3.5, randomRange(random, 0.004, 0.009));
    mixInto(samples, burst, Math.round(time * rate), strength * randomRange(random, 0.4, 1));
    time += randomRange(random, 0.018, 0.05);
  }
};

/** Palm crowns: dry frond clatter and flaps in gusts over a papery, low whoosh. */
export const renderFrondClatter = (input: SynthInput) => {
  const { random, rate } = input;
  const length = loopLength(rate);
  const gust = smoothRandomCurve(random, length, rate, 0.6);
  const samples = bandpass(pinkNoise(random, length), () => 1100, 0.6, rate);
  multiply(samples, (index) => 0.15 + 0.45 * gust[index]! ** 2);
  forEachEvent(random, length / rate - 0.4, 7, (time) => {
    const level = gust[Math.round(time * rate)]!;
    if (random() < level) addFrondFlap(input, samples, time, 0.6 + level);
  });
  highpass(samples, 250, rate);
  return normalize(makeLoop(samples, LOOP_FADE_SECONDS, rate), 0.12);
};
