/**
 * Pure statistics for the A/B perf runner (TOOL-4, `ab-runner.ts`). No I/O: every function takes plain numbers so the
 * noise rules stay unit tested (`tests/ab-stats.test.ts`).
 *
 * Noise model: each side's spread is its MAD (median absolute deviation) scaled by 1.4826, a robust stand-in for one
 * standard deviation that ignores a single run under foreign load. The base and lane spreads are pooled and doubled
 * (about a 95 % band); a median delta inside that band is reported as "within noise". The paired band (spread of
 * the per-round lane-minus-base differences) is reported beside it: with alternating rounds it cancels slow drift.
 */

/** MAD to standard deviation factor for normally distributed samples. */
export const MAD_SIGMA = 1.4826;
/** Band width in robust standard deviations (about 95 % for a normal sample). */
export const NOISE_SIGMAS = 2;

export interface SampleSummary {
  count: number;
  iqr: number;
  mad: number;
  max: number;
  median: number;
  min: number;
}

export interface MetricComparison {
  base: SampleSummary;
  delta: number;
  /** Delta relative to the base median; null when the base median is 0. */
  deltaPercent: number | null;
  lane: SampleSummary;
  /** Absolute band a delta must exceed to count as a change. */
  noiseBand: number;
  /** Band of the paired differences (NOISE_SIGMAS robust sigmas); null with fewer than 3 rounds. */
  pairedBand: number | null;
  /** Median of the per-round lane-minus-base differences (rounds alternate, so drift cancels). */
  pairedDelta: number | null;
  rangesOverlap: boolean;
  withinNoise: boolean;
}

const sorted = (values: readonly number[]) => values.slice().sort((a, b) => a - b);

/** Linear-interpolated quantile of an ascending array (`share` in 0..1). */
export const quantileOfSorted = (ascending: readonly number[], share: number) => {
  if (!ascending.length) return Number.NaN;
  const position = (ascending.length - 1) * Math.min(1, Math.max(0, share));
  const low = ascending[Math.floor(position)] ?? Number.NaN;
  const high = ascending[Math.ceil(position)] ?? Number.NaN;
  return low + (high - low) * (position - Math.floor(position));
};

export const median = (values: readonly number[]) => quantileOfSorted(sorted(values), .5);

export const medianAbsoluteDeviation = (values: readonly number[]) => {
  if (!values.length) return Number.NaN;
  const centre = median(values);
  return median(values.map(value => Math.abs(value - centre)));
};

export const summarize = (values: readonly number[]): SampleSummary => {
  const ascending = sorted(values);
  return {
    count: ascending.length,
    iqr: quantileOfSorted(ascending, .75) - quantileOfSorted(ascending, .25),
    mad: medianAbsoluteDeviation(ascending),
    max: ascending.at(-1) ?? Number.NaN,
    median: quantileOfSorted(ascending, .5),
    min: ascending[0] ?? Number.NaN
  };
};

/** Pooled robust band: NOISE_SIGMAS x sqrt(sigmaBase^2 + sigmaLane^2). */
export const noiseBandOf = (base: SampleSummary, lane: SampleSummary) =>
  NOISE_SIGMAS * MAD_SIGMA * Math.hypot(base.mad, lane.mad);

/** Per-round differences; rounds are matched by index, extra runs on one side are ignored. */
export const pairedDifferences = (base: readonly number[], lane: readonly number[]) => {
  const count = Math.min(base.length, lane.length);
  return Array.from({ length: count }, (_, index) => (lane[index] ?? 0) - (base[index] ?? 0));
};

const pairedBandOf = (differences: readonly number[]) => {
  if (differences.length < 3) return null;
  return NOISE_SIGMAS * MAD_SIGMA * medianAbsoluteDeviation(differences);
};

export const compareSamples = (base: readonly number[], lane: readonly number[]): MetricComparison => {
  const baseSummary = summarize(base);
  const laneSummary = summarize(lane);
  const delta = laneSummary.median - baseSummary.median;
  const noiseBand = noiseBandOf(baseSummary, laneSummary);
  const differences = pairedDifferences(base, lane);
  return {
    base: baseSummary,
    delta,
    deltaPercent: baseSummary.median === 0 ? null : delta / Math.abs(baseSummary.median) * 100,
    lane: laneSummary,
    noiseBand,
    pairedBand: pairedBandOf(differences),
    pairedDelta: differences.length ? median(differences) : null,
    rangesOverlap: laneSummary.min <= baseSummary.max && baseSummary.min <= laneSummary.max,
    withinNoise: Math.abs(delta) <= noiseBand
  };
};

export interface DeterminismCheck {
  /** Every run on both sides printed the same value. */
  allEqual: boolean;
  baseValues: string[];
  laneValues: string[];
  /** Each side is internally stable (same value on every run of that side). */
  stablePerSide: boolean;
}

const distinct = (values: readonly string[]) => [...new Set(values)];

export const checkDeterminism = (base: readonly string[], lane: readonly string[]): DeterminismCheck => {
  const baseValues = distinct(base);
  const laneValues = distinct(lane);
  return {
    allEqual: baseValues.length === 1 && laneValues.length === 1 && baseValues[0] === laneValues[0],
    baseValues,
    laneValues,
    stablePerSide: baseValues.length <= 1 && laneValues.length <= 1
  };
};

export type RunSide = "base" | "lane";

/**
 * Run order that cancels linear drift: ABBA blocks (A B, B A, A B, ...) or plain alternation (A B A B).
 * Each round runs both sides once.
 */
export const runOrder = (rounds: number, pattern: "abab" | "abba"): RunSide[] =>
  Array.from({ length: rounds }, (_, round): RunSide[] =>
    pattern === "abba" && round % 2 === 1 ? ["lane", "base"] : ["base", "lane"]).flat();
