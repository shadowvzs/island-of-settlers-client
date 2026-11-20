import {
  createSamples,
  highpass,
  makeLoop,
  mixInto,
  normalize,
  randomRange,
  renderTone,
  type SynthInput,
  windowShape} from "./dsp";

const LOOP_FADE_SECONDS = 0.8;
const CRICKET_LOOP_SECONDS = 8;
const CRICKET_VOICES = 4;

/** One chirp: a few short pulses of a pure, high carrier (the wing stroke file). */
const renderChirp = (rate: number, carrier: number, pulses: number, pulseSeconds: number) => {
  const gap = pulseSeconds * 0.9;
  const seconds = pulses * (pulseSeconds + gap);
  return renderTone(
    {
      amplitudeAt: (t) => {
        const position = (t * seconds) % (pulseSeconds + gap);
        return position < pulseSeconds ? windowShape(position / pulseSeconds, 0.3, 0.5) : 0;
      },
      frequencyAt: (t) => carrier * (1 - 0.015 * t),
      harmonics: [1, 0.08],
      seconds
    },
    rate
  );
};

/**
 * Night meadow: a few crickets, each with its own pitch, pulse count and chirp rhythm (some
 * drift slightly), so the chorus never locks into one beat.
 */
export const renderCrickets = ({ random, rate }: SynthInput) => {
  const seconds = CRICKET_LOOP_SECONDS + LOOP_FADE_SECONDS;
  const samples = createSamples(seconds, rate);
  for (let voice = 0; voice < CRICKET_VOICES; voice += 1) {
    const carrier = randomRange(random, 3900, 5200);
    const pulses = 2 + Math.floor(random() * 3);
    const pulseSeconds = randomRange(random, 0.011, 0.018);
    const interval = randomRange(random, 0.38, 0.85);
    const level = randomRange(random, 0.35, 1) * (voice === 0 ? 1 : 0.6);
    const chirp = renderChirp(rate, carrier, pulses, pulseSeconds);
    for (
      let time = random() * interval;
      time < seconds;
      time += interval * randomRange(random, 0.92, 1.1)
    ) {
      if (random() < 0.12) continue;
      mixInto(samples, chirp, Math.round(time * rate), level * randomRange(random, 0.7, 1));
    }
  }
  highpass(samples, 2000, rate);
  return normalize(makeLoop(samples, LOOP_FADE_SECONDS, rate), 0.07, 0.6);
};
