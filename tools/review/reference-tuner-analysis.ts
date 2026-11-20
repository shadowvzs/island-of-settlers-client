import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { cloudDrift, cloudScore, cloudShapeMetrics, edgeFlicker, skyColourMetrics } from "./reference-cloud-metrics";
import { writeImage } from "./reference-frames";
import { cropImage, FULL_FRAME, type Landward, lumaAt, orientLandDown, quantile, type Roi, rounded,
  saturationAt, type TimedFrame } from "./reference-image";
import { drawEdgeCrops, drawSwashOverlay } from "./reference-overlay";
import { analyseShoreStill, analyseSwash } from "./reference-swash-metrics";
import { type TunerKind } from "./reference-tuner-spec";
import { type SheetCell } from "./review-contact-sheet";

/**
 * Turns frame series (reference clip or game strip) into metrics plus sheet cells (TOOL-8). Motion
 * metrics are dropped for moving cameras; the overlays show what the swash metrics detected.
 */

export type MetricValue = number | null | (number | null)[];
export type Metrics = Record<string, MetricValue>;

export interface AnalysisOptions {
  fps: number;
  hfov: number;
  label: string;
  landward: Landward;
  /** False for moving cameras: timing and drift metrics are left out. */
  motion: boolean;
  outDir: string;
  roi?: Roi;
}

export interface AnalysedSubject {
  cells: SheetCell[];
  label: string;
  metrics: Metrics;
}

/** Swash metrics that need a still camera. */
const SWASH_MOTION_KEYS = /^(swash|sheet)(Period|Uprush|Backwash|Rest|Cycles|PeakDwell)|^cycles$/;
/** Frames whose cloud shape metrics are averaged. */
const CLOUD_SHAPE_FRAMES = 8;

const prepare = (frames: readonly TimedFrame[], roi: Roi | undefined, landward: Landward) =>
  frames.map(frame => ({ ...frame, image: orientLandDown(cropImage(frame.image, roi ?? FULL_FRAME), landward) }));

/** Median of every metric over several records (per channel for colour triples). */
const medianRecord = (records: Metrics[]): Metrics => {
  const keys = [...new Set(records.flatMap(record => Object.keys(record)))].sort();
  return Object.fromEntries(keys.map(key => {
    const values = records.map(record => record[key]).filter(value => value !== undefined && value !== null);
    if (Array.isArray(values[0])) return [key, (values[0] as (number | null)[]).map((_, channel) =>
      rounded(quantile(values.map(value => Number((value as (number | null)[])[channel])), 0.5), 1))];
    return [key, rounded(quantile(values.map(Number), 0.5), 4)];
  }));
};

const analyseSwashFrames = (frames: readonly TimedFrame[], options: AnalysisOptions): AnalysedSubject => {
  const { metrics, overlay } = analyseSwash(frames, options.fps);
  const kept = Object.fromEntries(Object.entries(metrics)
    .filter(([key]) => options.motion || !SWASH_MOTION_KEYS.test(key)));
  const cells = [0.15, 0.45, 0.75].map(share => {
    const index = Math.floor((frames.length - 1) * share);
    const file = resolve(options.outDir, `overlay-${index}.png`);
    writeImage(drawSwashOverlay(frames[index]!.image, overlay(index)), file);
    return { label: `${options.label} detect t=${frames[index]!.seconds.toFixed(1)} s`, path: file };
  });
  return { cells, label: options.label, metrics: kept };
};

const analyseCloudFrames = (frames: readonly TimedFrame[], options: AnalysisOptions): AnalysedSubject => {
  const step = Math.max(1, Math.floor(frames.length / CLOUD_SHAPE_FRAMES));
  const sampled = frames.filter((_, index) => index % step === 0);
  const shapes = sampled.map(frame => cloudShapeMetrics(frame.image, options.hfov)).filter(shape => shape !== null);
  const colours = sampled.map(frame => skyColourMetrics(frame.image));
  const drift = options.motion ? cloudDrift(frames, options.hfov) : {};
  const metrics = { ...medianRecord(shapes as Metrics[]), ...medianRecord(colours as Metrics[]), ...drift,
    ...edgeFlicker(frames), shapeFrames: shapes.length };
  const file = resolve(options.outDir, "analysed.png");
  writeImage(frames[0]!.image, file);
  return { cells: [{ label: `${options.label} analysed`, path: file }, ...edgeCropCells(frames, options)],
    label: options.label, metrics };
};

/** Zoomed edge crop of the first two frames and their difference (×8): the sparkle/fizz check. */
const edgeCropCells = (frames: readonly TimedFrame[], options: AnalysisOptions) => {
  const score = frames.length > 1 ? cloudScore(frames[0]!.image) : null;
  if (!score) return [];
  const edge = Uint8Array.from(score, value => (value > 0.2 && value < 0.8 ? 1 : 0));
  const file = resolve(options.outDir, "edge-crop.png");
  writeImage(drawEdgeCrops(frames[0]!.image, frames[1]!.image, edge), file);
  const step = (frames[1]!.seconds - frames[0]!.seconds).toFixed(2);
  return [{ label: `${options.label} edge ×4: A | B (+${step} s) | |B−A|×8`, path: file }];
};

/** Metrics and diagnostic cells of one frame series. */
export const analyseFrames = (kind: TunerKind, frames: readonly TimedFrame[], options: AnalysisOptions) => {
  mkdirSync(options.outDir, { recursive: true });
  const prepared = prepare(frames, options.roi, options.landward);
  return kind === "swash" ? analyseSwashFrames(prepared, options) : analyseCloudFrames(prepared, options);
};

/**
 * Whole-frame look of a scene view (exposure review): median and 95th percentile luma, mean
 * saturation (vividness) and the dark/bright colours.
 */
export const analyseLook = (frames: readonly TimedFrame[], options: AnalysisOptions): AnalysedSubject => {
  mkdirSync(options.outDir, { recursive: true });
  const { image } = frames.at(-1)!;
  const pixels = Array.from({ length: image.width * image.height }, (_, pixel) => pixel);
  const lumas = pixels.map(pixel => lumaAt(image, pixel));
  const metrics: Metrics = { ...skyColourMetrics(image), lumaP95: rounded(quantile(lumas, 0.95), 1),
    meanSaturation: rounded(pixels.reduce((sum, pixel) => sum + saturationAt(image, pixel), 0) / pixels.length) };
  return { cells: [], label: options.label, metrics };
};

/** Shore bands of a still photo (dry → wet band → foam line). */
export const analyseStill = (frame: TimedFrame, options: AnalysisOptions): AnalysedSubject => {
  mkdirSync(options.outDir, { recursive: true });
  const [prepared] = prepare([frame], options.roi, options.landward);
  const file = resolve(options.outDir, "analysed.png");
  writeImage(prepared!.image, file);
  return { cells: [{ label: `${options.label} analysed`, path: file }], label: options.label,
    metrics: analyseShoreStill(prepared!.image) };
};
