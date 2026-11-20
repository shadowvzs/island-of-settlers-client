import type { Random } from "../../../shared/world/rng";
import {
  bandpass,
  createSamples,
  mixInto,
  normalizePeak,
  pinkNoise,
  randomRange,
  renderTone,
  type SynthInput,
  windowShape} from "./dsp";

type Contour = "rise" | "fall" | "arch" | "flat";
const CONTOURS: readonly Contour[] = ["rise", "fall", "arch", "flat"];

const pick = <T>(random: Random, items: readonly T[]) =>
  items[Math.floor(random() * items.length)]!;

const contourAt = (contour: Contour, t: number) => {
  if (contour === "rise") return -0.5 + t;
  if (contour === "fall") return 0.5 - t;
  if (contour === "arch") return Math.sin(Math.PI * t) - 0.5;
  return 0;
};

/** One songbird note: a whistle swept along a contour, with an optional fast trill (FM). */
const renderNote = (random: Random, rate: number, pitch: number, trill: boolean) => {
  const contour = pick(random, CONTOURS);
  const sweep = randomRange(random, 0.15, 0.6);
  const trillRate = randomRange(random, 28, 46);
  const trillDepth = trill ? randomRange(random, 0.05, 0.12) : 0;
  const seconds = trill ? randomRange(random, 0.12, 0.3) : randomRange(random, 0.035, 0.11);
  return renderTone(
    {
      amplitudeAt: (t) => windowShape(t, 0.15, 0.4),
      frequencyAt: (t) =>
        pitch *
        (1 + sweep * contourAt(contour, t)) *
        (1 + trillDepth * Math.sin(2 * Math.PI * trillRate * t * seconds)),
      harmonics: [1, 0.12, 0.04],
      seconds
    },
    rate
  );
};

/**
 * Songbird phrase: 1 to 7 notes with their own contour, pitch and spacing; some phrases end
 * in a trill. Every call is a fresh random phrase, so a forest never repeats itself.
 */
export const renderSongbirdCall = ({ random, rate }: SynthInput) => {
  const notes = 1 + Math.floor(random() * 7);
  const pitch = randomRange(random, 2600, 5200);
  const samples = createSamples(1.8, rate);
  let time = 0.01;
  for (let note = 0; note < notes; note += 1) {
    const trill = note === notes - 1 && random() < 0.35;
    const notePitch = pitch * randomRange(random, 0.8, 1.25);
    const rendered = renderNote(random, rate, notePitch, trill);
    mixInto(samples, rendered, Math.round(time * rate), randomRange(random, 0.55, 1));
    time += rendered.length / rate + randomRange(random, 0.02, 0.12);
  }
  return normalizePeak(samples.slice(0, Math.round((time + 0.05) * rate)), 0.8);
};

/** Swift: a thin, buzzy, high scream (fast FM over a falling whistle), sometimes doubled. */
export const renderSwiftCall = ({ random, rate }: SynthInput) => {
  const screams = random() < 0.4 ? 2 : 1;
  const samples = createSamples(1.2, rate);
  for (let scream = 0; scream < screams; scream += 1) {
    const pitch = randomRange(random, 5200, 7000);
    const seconds = randomRange(random, 0.25, 0.45);
    const tone = renderTone(
      {
        amplitudeAt: (t) => windowShape(t, 0.1, 0.5) * (0.7 + 0.3 * Math.sin(t * 190)),
        frequencyAt: (t) =>
          pitch * (1.05 - 0.15 * t) * (1 + 0.08 * Math.sin(t * seconds * 2 * Math.PI * 70)),
        harmonics: [1, 0.25],
        seconds
      },
      rate
    );
    mixInto(samples, tone, Math.round(scream * randomRange(random, 0.3, 0.5) * rate));
  }
  return normalizePeak(samples, 0.6);
};

/** Formant filtered harsh tone: harmonic rich source through two vocal tract resonances. */
const renderVoiced = (
  input: SynthInput,
  seconds: number,
  frequencyAt: (t: number) => number,
  formants: readonly [number, number]
) => {
  const { random, rate } = input;
  const source = renderTone(
    {
      amplitudeAt: (t) => windowShape(t, 0.08, 0.45),
      frequencyAt,
      harmonics: [1, 0.7, 0.55, 0.45, 0.35, 0.28, 0.2, 0.15],
      seconds
    },
    rate
  );
  const rasp = pinkNoise(random, source.length);
  for (let index = 0; index < source.length; index += 1) source[index]! *= 1 + 0.6 * rasp[index]!;
  const first = bandpass(source.slice(), () => formants[0], 2.5, rate);
  const second = bandpass(source, () => formants[1], 3, rate);
  for (let index = 0; index < first.length; index += 1) first[index]! += second[index]! * 0.7;
  return first;
};

/** Rook / crow: one to three hoarse, falling "caws". */
export const renderCrowCall = (input: SynthInput) => {
  const { random, rate } = input;
  const caws = 1 + Math.floor(random() * 3);
  const samples = createSamples(caws * 0.6 + 0.2, rate);
  const pitch = randomRange(random, 380, 520);
  for (let caw = 0; caw < caws; caw += 1) {
    const seconds = randomRange(random, 0.22, 0.36);
    const voiced = renderVoiced(input, seconds, (t) => pitch * (1.05 - 0.2 * t), [1300, 2300]);
    mixInto(samples, voiced, Math.round(caw * randomRange(random, 0.45, 0.6) * rate));
  }
  return normalizePeak(samples, 0.7);
};

/** Gull: a rising then falling "kee-ow", or a short laughing series. */
export const renderGullCall = (input: SynthInput) => {
  const { random, rate } = input;
  const laugh = random() < 0.35;
  const notes = laugh ? 3 + Math.floor(random() * 4) : 1;
  const samples = createSamples(notes * 0.32 + 0.6, rate);
  const pitch = randomRange(random, 850, 1150);
  for (let note = 0; note < notes; note += 1) {
    const seconds = laugh ? randomRange(random, 0.12, 0.18) : randomRange(random, 0.45, 0.65);
    const frequencyAt = laugh
      ? (t: number) => pitch * (1.1 - 0.2 * t)
      : (t: number) => pitch * (0.9 + 0.7 * Math.sin(Math.PI * Math.min(1, t * 1.4)) - 0.25 * t);
    const voiced = renderVoiced(input, seconds, frequencyAt, [1900, 3200]);
    mixInto(samples, voiced, Math.round(note * (laugh ? 0.2 : 0) * rate));
  }
  return normalizePeak(samples, 0.7);
};
