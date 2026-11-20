import {
  bandpass,
  createSamples,
  forEachEvent,
  mixInto,
  multiply,
  normalizePeak,
  pinkNoise,
  randomRange,
  renderBurst,
  renderTone,
  type SynthInput,
  windowShape} from "./dsp";

/** Deer alarm bark: a short, breathy, low "bwah" (noisy formant burst over a low voice). */
export const renderDeerBark = (input: SynthInput) => {
  const { random, rate } = input;
  const seconds = randomRange(random, 0.16, 0.24);
  const pitch = randomRange(random, 220, 260);
  const breath = bandpass(pinkNoise(random, Math.round(seconds * rate)), () => 750, 1.8, rate);
  const voice = renderTone(
    {
      amplitudeAt: (t) => windowShape(t, 0.08, 0.7),
      frequencyAt: (t) => pitch * (1.1 - 0.3 * t),
      harmonics: [1, 0.6, 0.35, 0.2],
      seconds
    },
    rate
  );
  multiply(breath, (index) => windowShape(index / breath.length, 0.05, 0.75));
  const samples = createSamples(seconds + 0.05, rate);
  mixInto(samples, breath, 0, 1.4);
  mixInto(samples, voice, 0, 0.6);
  return normalizePeak(samples, 0.6);
};

/** Elk bugle: a far, airy whistle that climbs and breaks off, followed by a low grunt. */
export const renderElkBugle = (input: SynthInput) => {
  const { random, rate } = input;
  const seconds = randomRange(random, 1, 1.5);
  const top = randomRange(random, 1300, 1700);
  const whistle = renderTone(
    {
      amplitudeAt: (t) => windowShape(t, 0.3, 0.25) * (0.85 + 0.15 * Math.sin(t * 60)),
      frequencyAt: (t) => 500 + (top - 500) * Math.min(1, t * 1.6),
      harmonics: [1, 0.3, 0.1],
      seconds
    },
    rate
  );
  const grunt = renderTone(
    {
      amplitudeAt: (t) => windowShape(t, 0.1, 0.6),
      frequencyAt: () => 110,
      harmonics: [1, 0.8, 0.5, 0.3],
      seconds: 0.3
    },
    rate
  );
  const samples = createSamples(seconds + 0.5, rate);
  mixInto(samples, whistle, 0);
  mixInto(samples, grunt, Math.round((seconds + 0.1) * rate), 0.5);
  return normalizePeak(samples, 0.45);
};

/** Small animal in the grass: a short rustle and, sometimes, a soft foot thump (rabbit). */
export const renderGrassRustle = (input: SynthInput) => {
  const { random, rate } = input;
  const seconds = randomRange(random, 0.3, 0.6);
  const samples = createSamples(seconds + 0.1, rate);
  forEachEvent(random, seconds, 70, (time) => {
    const burst = renderBurst(input, 0.012, randomRange(random, 1500, 4500), 1.4, 0.004);
    const shape = windowShape(time / seconds, 0.3, 0.5);
    mixInto(samples, burst, Math.round(time * rate), shape * randomRange(random, 0.3, 1));
  });
  if (random() < 0.5) {
    const thump = renderTone(
      {
        amplitudeAt: (t) => Math.min(1, t * 30) * Math.exp(-t * 7),
        frequencyAt: () => 85,
        seconds: 0.12
      },
      rate
    );
    mixInto(samples, thump, Math.round(seconds * 0.6 * rate), 1.5);
  }
  return normalizePeak(samples, 0.5);
};
