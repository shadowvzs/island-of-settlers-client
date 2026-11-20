import { lumaAt, mean, quantile, type RgbImage, rounded, type TimedFrame } from "./reference-image";
import { type SwashOverlay } from "./reference-overlay";
import { dryEdgeRow, foamMask, foamWidthAt, frontRow, profileMedian, rowProfile,
  sandLumaBetween, shoreThresholds }
  from "./reference-shore-bands";

/**
 * Swash metrics of a land-down frame series (TOOL-8). Times are in seconds, so reference and game
 * compare directly; lengths are relative to the swash excursion (the camera scales differ).
 */

export interface SwashSeries {
  /** Share of columns with a foam front per frame. */
  continuity: number[];
  /** Median front row per frame (NaN without foam). */
  front: number[];
  /** Gaps (runs of columns without front between columns with one) per 100 columns, per frame. */
  gaps: number[];
  seconds: number[];
  /** Median landward-most moving row per frame: the water sheet's edge, foamy or clear (NaN = none). */
  sheet: number[];
}

export interface SwashCycle {
  backwashSeconds: number;
  excursionRows: number;
  /** Time the front stays within PEAK_SHARE of its high (foam left at the highest run-up). */
  peakDwellSeconds: number;
  periodSeconds: number;
  restSeconds: number;
  uprushSeconds: number;
}

/** A cycle drains back once the front is within this share of its excursion above the next low. */
const DRAINED_SHARE = 0.15;
/** The front dwells at its peak while it is above this share of the cycle's excursion. */
const PEAK_SHARE = 0.85;
/** Cycles smaller than this share of the clip's excursion are noise (foam flecks, a small bore). */
const MIN_CYCLE_SHARE = 0.25;

const frontsOf = (mask: Uint8Array, image: RgbImage) =>
  Array.from({ length: image.width }, (_, column) => frontRow(mask, image.width, image.height, column));

const gapsPer100 = (fronts: number[]) => {
  let gaps = 0, seen = false, inGap = false;
  for (const front of fronts) {
    if (front < 0) { inGap = seen; continue; }
    if (inGap) gaps++;
    seen = true;
    inGap = false;
  }
  return (gaps * 100) / fronts.length;
};

const smooth = (values: number[], radius: number) => values.map((_, index) => {
  const window = values.slice(Math.max(0, index - radius), index + radius + 1).filter(Number.isFinite);
  return window.length ? mean(window) : Number.NaN;
});

/** Local extrema of `values` (strict within ±radius samples). */
const extrema = (values: number[], radius: number, compare: (a: number, b: number) => boolean) =>
  values.flatMap((value, index) => {
    if (!Number.isFinite(value)) return [];
    const window = values.slice(Math.max(0, index - radius), index + radius + 1);
    return window.every(other => !Number.isFinite(other) || other === value || compare(value, other)) ? [index] : [];
  });

/** Swash periods searched by the autocorrelation (seconds). */
const PERIOD_RANGE = [2, 20] as const;

/** Lag (seconds) of the strongest autocorrelation peak of `values` sampled at `fps`; NaN if none. */
export const dominantPeriod = (values: number[], fps: number) => {
  const average = mean(values.filter(Number.isFinite));
  const centred = values.map(value => (Number.isFinite(value) ? value - average : 0));
  const correlation = (lag: number) => {
    let sum = 0;
    for (let index = 0; index + lag < centred.length; index++) sum += centred[index]! * centred[index + lag]!;
    return sum / (centred.length - lag);
  };
  const lags = Array.from({ length: Math.round(PERIOD_RANGE[1] * fps) + 2 }, (_, lag) => correlation(lag));
  let best = Number.NaN, bestValue = 0;
  for (let lag = Math.round(PERIOD_RANGE[0] * fps); lag < lags.length - 1 && lag < centred.length / 2; lag++) {
    const peak = lags[lag]! > lags[lag - 1]! && lags[lag]! >= lags[lag + 1]!;
    if (peak && lags[lag]! > bestValue) { best = lag / fps; bestValue = lags[lag]!; }
  }
  return best;
};

/**
 * Cycles of a front series between consecutive lows (minima within ±35 % of the dominant period):
 * uprush to the high, backwash until drained, rest until the next low.
 */
export const swashCycles = (values: number[], seconds: number[], fps: number): SwashCycle[] => {
  const front = smooth(values, Math.max(1, Math.round(fps * 0.15)));
  const finite = front.filter(Number.isFinite);
  const clipExcursion = quantile(finite, 0.95) - quantile(finite, 0.05);
  const period = dominantPeriod(front, fps);
  if (!Number.isFinite(period)) return [];
  const radius = Math.max(1, Math.round(period * fps * 0.35));
  // A resting front is a plateau of lows: its last sample is where the next uprush starts.
  const lows = extrema(front, radius, (value, other) => value < other)
    .filter((low, index, all) => index + 1 === all.length || all[index + 1]! - low > radius);
  const cycles: SwashCycle[] = [];
  for (let index = 0; index + 1 < lows.length; index++) {
    const start = lows[index]!, end = lows[index + 1]!;
    let high = start;
    for (let at = start; at <= end; at++) if (front[at]! > front[high]!) high = at;
    const floor = Math.max(front[start]!, front[end]!);
    const excursion = front[high]! - Math.min(front[start]!, front[end]!);
    if (!(excursion >= clipExcursion * MIN_CYCLE_SHARE)) continue;
    let drained = high;
    while (drained < end && front[drained]! > floor + excursion * DRAINED_SHARE) drained++;
    const time = (at: number) => seconds[at]!;
    const peakLine = Math.min(front[start]!, front[end]!) + excursion * PEAK_SHARE;
    const dwell = front.slice(start, end + 1).filter(value => value >= peakLine).length / fps;
    cycles.push({ backwashSeconds: time(drained) - time(high), excursionRows: excursion, peakDwellSeconds: dwell,
      periodSeconds: time(end) - time(start), restSeconds: time(end) - time(drained),
      uprushSeconds: time(high) - time(start) });
  }
  return cycles;
};

/** Luma change that marks moving water between two frames MOTION_SECONDS apart. */
const MOTION_LEVELS = 8;
const MOTION_SECONDS = 0.2;

/** Median landward-most row that changed between two frames (2 of 3 vertical neighbours agree). */
const movingEdge = (before: RgbImage, after: RgbImage) => {
  const { height, width } = after, edges: number[] = [];
  const moved = (pixel: number) => Math.abs(lumaAt(after, pixel) - lumaAt(before, pixel)) > MOTION_LEVELS ? 1 : 0;
  for (let column = 0; column < width; column += 2)
    for (let row = Math.floor(height * 0.9) - 2; row >= 1; row--) {
      const pixel = row * width + column;
      if (moved(pixel - width) + moved(pixel) + moved(pixel + width) < 2) continue;
      edges.push(row);
      break;
    }
  return edges.length >= width * 0.05 ? quantile(edges, 0.5) : Number.NaN;
};

const sheetSeries = (frames: readonly TimedFrame[]) => frames.map((frame, index) => {
  const before = frames.findLast(other => other.seconds <= frame.seconds - MOTION_SECONDS + 1e-6);
  return before && index > 0 ? movingEdge(before.image, frame.image) : Number.NaN;
});

/** Foam front, continuity, dash gaps and moving sheet edge of every frame. */
export const swashSeries = (frames: readonly TimedFrame[]) => {
  const images = frames.map(frame => frame.image);
  const thresholds = shoreThresholds(images);
  const masks = images.map(image => foamMask(image, thresholds));
  const series: SwashSeries = { continuity: [], front: [], gaps: [], seconds: frames.map(frame => frame.seconds),
    sheet: sheetSeries(frames) };
  const widths: number[] = [], foamLumas: number[] = [], frontsPerFrame: number[][] = [];
  images.forEach((image, index) => {
    const fronts = frontsOf(masks[index]!, image), found = fronts.filter(row => row >= 0);
    frontsPerFrame.push(fronts);
    series.front.push(found.length >= image.width * 0.1 ? quantile(found, 0.5) : Number.NaN);
    series.continuity.push(found.length / image.width);
    series.gaps.push(gapsPer100(fronts));
    fronts.forEach((row, column) => {
      if (row < 0) return;
      widths.push(foamWidthAt(masks[index]!, image.width, column, row));
      foamLumas.push(lumaAt(image, row * image.width + column));
    });
  });
  return { foamLumas, frontsPerFrame, images, masks, series, thresholds, widths };
};

const median = (values: number[]) => quantile(values.filter(Number.isFinite), 0.5);

/**
 * All swash metrics of a land-down clip or game strip sampled at `fps`, and the diagnostic overlay
 * of any analysed frame.
 */
export const analyseSwash = (frames: readonly TimedFrame[], fps: number) => {
  const { foamLumas, frontsPerFrame, images, masks, series, thresholds, widths } = swashSeries(frames);
  const cycles = swashCycles(series.front, series.seconds, fps);
  const sheetCycles = swashCycles(series.sheet, series.seconds, fps);
  const finite = series.front.filter(Number.isFinite);
  const reachLow = quantile(finite, 0.05), reachHigh = quantile(finite, 0.95);
  const excursion = reachHigh - reachLow;
  const profile = rowProfile(images, masks);
  const dryEdge = dryEdgeRow(profile, thresholds.dryLuma, reachHigh);
  const foamed = series.continuity.filter(share => share >= 0.1);
  const foamWidth = median(widths);
  const overlay = (index: number): SwashOverlay => ({ fronts: frontsPerFrame[index]!,
    lines: { dryEdge, reachHigh, reachLow, sheet: series.sheet[index]! }, mask: masks[index]! });
  const metrics = {
    cycles: cycles.length,
    dryLuma: rounded(thresholds.dryLuma, 1),
    excursionShareOfFrame: rounded(excursion / images[0]!.height),
    foamFrontBrightness: rounded(median(foamLumas) / thresholds.dryLuma),
    foamFrontContinuity: rounded(median(foamed)),
    foamFrontGapsPer100Columns: rounded(median(series.gaps.filter((_, index) => series.continuity[index]! >= 0.1))),
    foamFramesShare: rounded(foamed.length / series.front.length),
    foamWidthToExcursion: rounded(foamWidth / excursion),
    foamWidthVariation: rounded((quantile(widths, 0.9) - quantile(widths, 0.1)) / Math.max(1, foamWidth)),
    swashBackwashSeconds: rounded(median(cycles.map(cycle => cycle.backwashSeconds)), 2),
    swashBackwashShare: rounded(median(cycles.map(cycle => cycle.backwashSeconds / cycle.periodSeconds))),
    swashPeriodSeconds: rounded(median(cycles.map(cycle => cycle.periodSeconds)), 2),
    swashRestShare: rounded(median(cycles.map(cycle => cycle.restSeconds / cycle.periodSeconds))),
    swashUprushSeconds: rounded(median(cycles.map(cycle => cycle.uprushSeconds)), 2),
    swashPeakDwellShare: rounded(median(cycles.map(cycle => cycle.peakDwellSeconds / cycle.periodSeconds))),
    swashUprushShare: rounded(median(cycles.map(cycle => cycle.uprushSeconds / cycle.periodSeconds))),
    sheetBackwashSeconds: rounded(median(sheetCycles.map(cycle => cycle.backwashSeconds)), 2),
    sheetCycles: sheetCycles.length,
    sheetPeriodSeconds: rounded(median(sheetCycles.map(cycle => cycle.periodSeconds)), 2),
    sheetUprushSeconds: rounded(median(sheetCycles.map(cycle => cycle.uprushSeconds)), 2),
    swashZoneDarkness: rounded(profileMedian(profile, reachLow, reachHigh) / thresholds.dryLuma),
    swashZoneSandDarkness: rounded(sandLumaBetween(images, masks, reachLow, reachHigh) / thresholds.dryLuma),
    wetBandDarkness: rounded(profileMedian(profile, reachHigh, dryEdge) / thresholds.dryLuma),
    wetBandToExcursion: rounded(Math.max(0, dryEdge - reachHigh) / excursion)
  };
  return { metrics, overlay };
};

export type SwashMetrics = ReturnType<typeof analyseSwash>["metrics"];

/** Across-shore bands of one land-down still: dry sand → wet band → foam line → water. */
export const analyseShoreStill = (image: RgbImage) => {
  const thresholds = shoreThresholds([image]);
  const mask = foamMask(image, thresholds);
  const columns = frontsOf(mask, image).flatMap((row, column) => (row < 0 ? [] : [{ column, row }]));
  const front = quantile(columns.map(({ row }) => row), 0.5);
  const profile = rowProfile([image], [mask]);
  const dryEdge = dryEdgeRow(profile, thresholds.dryLuma, front + 1);
  const foamWidth = median(columns.map(({ column, row }) => foamWidthAt(mask, image.width, column, row)));
  const foamLumas = columns.map(({ column, row }) => lumaAt(image, row * image.width + column));
  return {
    dryLuma: rounded(thresholds.dryLuma, 1),
    foamFrontBrightness: rounded(median(foamLumas) / thresholds.dryLuma),
    foamFrontContinuity: rounded(columns.length / image.width),
    wetBandDarkness: rounded(profileMedian(profile, front + 1, dryEdge) / thresholds.dryLuma),
    wetBandToFoamWidth: rounded(Math.max(0, dryEdge - front) / Math.max(1, foamWidth))
  };
};
