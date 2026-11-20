import { lumaAt, mean, quantile, type RgbImage, rounded, type TimedFrame } from "./reference-image";

/**
 * Cloud metrics of sky frames (TOOL-8): whiteness-based cloud score, edge softness, rim and body
 * brightness against the sky, shadow-side colour, and drift speed by global shift search between
 * frames. Angles assume `hfov` degrees across the frame width (references: a guess per clip).
 */

/** Below this whiteness spread between sky and cloud the frame has no readable blue-sky clouds. */
const MIN_SCORE_CONTRAST = 0.12;
/** Largest shift (analysis pixels) searched between two frames. */
const MAX_SHIFT = 10;

/** Whiteness 0..1 (min/max channel): blue sky low, white or grey cloud high. */
const whiteness = (image: RgbImage, pixel: number) => {
  const offset = pixel * 3;
  const red = image.pixels[offset]!, green = image.pixels[offset + 1]!, blue = image.pixels[offset + 2]!;
  const high = Math.max(red, green, blue, 1);
  return Math.min(red, green, blue) / high;
};

/** Cloud score per pixel 0 (clear sky) .. 1 (cloud); null without sky/cloud contrast. */
export const cloudScore = (image: RgbImage) => {
  const values = new Float32Array(image.width * image.height);
  for (let pixel = 0; pixel < values.length; pixel++) values[pixel] = whiteness(image, pixel);
  const sky = quantile(values, 0.05), cloud = quantile(values, 0.97);
  if (cloud - sky < MIN_SCORE_CONTRAST) return null;
  for (let pixel = 0; pixel < values.length; pixel++)
    values[pixel] = Math.min(1, Math.max(0, (values[pixel]! - sky) / (cloud - sky)));
  return values;
};

/** Areas (pixels) of the 4-connected blobs of `mask`. */
const blobAreas = (mask: Uint8Array, width: number) => {
  const seen = new Uint8Array(mask.length), areas: number[] = [], stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let area = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const pixel = stack.pop()!, column = pixel % width;
      area++;
      for (const next of [pixel - width, pixel + width, column > 0 ? pixel - 1 : -1,
        column < width - 1 ? pixel + 1 : -1]) {
        if (next < 0 || next >= mask.length || !mask[next] || seen[next]) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    areas.push(area);
  }
  return areas;
};

const isEdge = (mask: Uint8Array, width: number, pixel: number) => {
  const column = pixel % width;
  return !mask[pixel - width] || !mask[pixel + width] || (column > 0 && !mask[pixel - 1])
    || (column < width - 1 && !mask[pixel + 1]);
};

const meanRgb = (image: RgbImage, pixels: number[]) => [0, 1, 2].map(channel =>
  rounded(mean(pixels.map(pixel => image.pixels[pixel * 3 + channel]!)), 0));

/** Blue minus red over luma: positive = cool (blue-grey) shading, negative = warm. */
const coolness = (image: RgbImage, pixels: number[]) => {
  const rgb = meanRgb(image, pixels).map(Number);
  return (rgb[2]! - rgb[0]!) / Math.max(1, rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722);
};

/** Tile size (analysis pixels) of the streak structure tensor. */
const STREAK_TILE = 12;

/**
 * Streaks in the clear sky: per tile, the gradient structure tensor of the luma over pixels with a
 * low cloud score; coherence 0 (no direction, blotches) .. 1 (parallel strokes), weighted by the
 * tile's gradient energy. Also the mean gradient energy, so a smooth sky (no texture) reads as such.
 */
const tileTensor = (image: RgbImage, score: Float32Array, top: number, left: number) => {
  const { width } = image, tensor = { count: 0, xx: 0, xy: 0, yy: 0 };
  for (let row = top; row < top + STREAK_TILE; row++) for (let column = left; column < left + STREAK_TILE; column++) {
    const pixel = row * width + column;
    if (score[pixel]! >= 0.5) continue;
    const dx = (lumaAt(image, pixel + 1) - lumaAt(image, pixel - 1)) / 2;
    const dy = (lumaAt(image, pixel + width) - lumaAt(image, pixel - width)) / 2;
    tensor.xx += dx * dx;
    tensor.yy += dy * dy;
    tensor.xy += dx * dy;
    tensor.count++;
  }
  return tensor;
};

const skyStreaks = (image: RgbImage, score: Float32Array) => {
  let weighted = 0, energy = 0, pixels = 0;
  for (let top = 1; top + STREAK_TILE < image.height; top += STREAK_TILE)
    for (let left = 1; left + STREAK_TILE < image.width; left += STREAK_TILE) {
      const { count, xx, xy, yy } = tileTensor(image, score, top, left);
      pixels += count;
      weighted += Math.sqrt((xx - yy) ** 2 + 4 * xy * xy);
      energy += xx + yy;
    }
  return { coherence: energy > 0 ? weighted / energy : Number.NaN, energy: pixels ? energy / pixels : Number.NaN };
};

/** Shape and colour metrics of one sky frame. */
export const cloudShapeMetrics = (image: RgbImage, hfov: number) => {
  const score = cloudScore(image);
  if (!score) return null;
  const { width } = image, mask = new Uint8Array(score.length);
  const sky: number[] = [], cloud: number[] = [], rim: number[] = [];
  let transition = 0, perimeter = 0;
  score.forEach((value, pixel) => { mask[pixel] = value > 0.5 ? 1 : 0; });
  score.forEach((value, pixel) => {
    if (value > 0.2 && value < 0.8) transition++;
    if (value < 0.15) sky.push(pixel);
    if (!mask[pixel]) return;
    cloud.push(pixel);
    if (isEdge(mask, width, pixel)) { perimeter++; rim.push(pixel); }
  });
  if (cloud.length < 50 || sky.length < 50) return null;
  const diameters = blobAreas(mask, width).filter(area => area >= 20).map(area => Math.sqrt((4 * area) / Math.PI));
  const edgeWidth = transition / Math.max(1, perimeter), blobDiameter = quantile(diameters, 0.5);
  const luma = (pixels: number[]) => pixels.map(pixel => lumaAt(image, pixel));
  const skyLuma = quantile(luma(sky), 0.5), cloudLumas = luma(cloud);
  const shadowCut = quantile(cloudLumas, 0.15), litLuma = quantile(cloudLumas, 0.9);
  const shadow = cloud.filter((_, index) => cloudLumas[index]! <= shadowCut);
  const lit = cloud.filter((_, index) => cloudLumas[index]! >= litLuma);
  const streaks = skyStreaks(image, score);
  return {
    blobDiameterDegrees: rounded((blobDiameter / width) * hfov),
    bodyToSky: rounded(quantile(cloudLumas, 0.95) / skyLuma),
    cloudShare: rounded(cloud.length / score.length),
    edgeSoftness: rounded(edgeWidth / Math.max(1, blobDiameter)),
    edgeWidthDegrees: rounded((edgeWidth / width) * hfov),
    rimToSky: rounded(quantile(luma(rim), 0.9) / skyLuma),
    shadowCoolness: rounded(coolness(image, shadow) - coolness(image, lit)),
    shadowRgb: meanRgb(image, shadow),
    shadowToLit: rounded(shadowCut / litLuma),
    skyRgb: meanRgb(image, sky),
    skyStreakCoherence: rounded(streaks.coherence),
    skyTextureEnergy: rounded(streaks.energy, 2)
  };
};

export type CloudShapeMetrics = NonNullable<ReturnType<typeof cloudShapeMetrics>>;

const differenceAt = (a: Float32Array, b: Float32Array, width: number, height: number, dx: number, dy: number) => {
  let sum = 0, count = 0;
  // A fixed margin one wider than the search keeps the sub-pixel neighbours inside the frame.
  const margin = MAX_SHIFT + 1;
  for (let row = margin; row < height - margin; row += 2)
    for (let column = margin; column < width - margin; column += 2) {
      sum += Math.abs(a[row * width + column]! - b[(row + dy) * width + column + dx]!);
      count++;
    }
  return count ? sum / count : Number.POSITIVE_INFINITY;
};

/** Sub-pixel vertex of a parabola through three costs (offset −0.5..0.5 from the middle). */
const vertex = (left: number, middle: number, right: number) => {
  const curvature = left - 2 * middle + right;
  return curvature > 0 ? Math.max(-0.5, Math.min(0.5, (left - right) / (2 * curvature))) : 0;
};

/** Global shift (pixels) moving `a` onto `b`, with the residual difference after the shift. */
export const estimateShift = (a: Float32Array, b: Float32Array, width: number, height: number) => {
  let best = { cost: Number.POSITIVE_INFINITY, dx: 0, dy: 0 };
  for (let dy = -MAX_SHIFT; dy <= MAX_SHIFT; dy++) for (let dx = -MAX_SHIFT; dx <= MAX_SHIFT; dx++) {
    const cost = differenceAt(a, b, width, height, dx, dy);
    if (cost < best.cost) best = { cost, dx, dy };
  }
  const at = (dx: number, dy: number) => differenceAt(a, b, width, height, dx, dy);
  const { cost, dx, dy } = best;
  return { dx: dx + vertex(at(dx - 1, dy), cost, at(dx + 1, dy)),
    dy: dy + vertex(at(dx, dy - 1), cost, at(dx, dy + 1)), residual: cost };
};

/** Frame pairs measured per step length. */
const PAIRS_PER_STEP = 24;
/** Step lengths tried (seconds), shortest first: the longest whose shift stays well inside the search wins. */
const DRIFT_STEPS = [0.2, 0.5, 1, 2, 4, 8, 16];

type Scores = (Float32Array | null)[];

/** Shifts of up to PAIRS_PER_STEP frame pairs about `step` seconds apart. */
const shiftsAt = (frames: readonly TimedFrame[], scores: Scores, step: number) => {
  const { height, width } = frames[0]!.image;
  const results: { residual: number; seconds: number; x: number; y: number }[] = [];
  const stride = Math.max(1, Math.floor(frames.length / PAIRS_PER_STEP));
  for (let index = 0; index < frames.length; index += stride) {
    const next = frames.findIndex(frame => frame.seconds >= frames[index]!.seconds + step - 1e-6);
    const a = scores[index], b = scores[next];
    if (next < 0) break;
    if (!a || !b) continue;
    const shift = estimateShift(a, b, width, height);
    results.push({ residual: shift.residual, seconds: frames[next]!.seconds - frames[index]!.seconds, x: shift.dx,
      y: shift.dy });
  }
  return results;
};

/**
 * Drift speed of the cloud field from the longest frame step whose median shift stays within 60 % of
 * the search (slow real-time drift needs seconds, a time-lapse a fraction): pixels → degrees per
 * second, plus the evolution rate (residual change after the shift, score units per second).
 */
export const cloudDrift = (frames: readonly TimedFrame[], hfov: number) => {
  const scores = frames.map(frame => cloudScore(frame.image));
  const duration = frames.at(-1)!.seconds - frames[0]!.seconds;
  let chosen: ReturnType<typeof shiftsAt> = [], step = 0;
  for (const candidate of DRIFT_STEPS.filter(each => each <= duration / 2)) {
    const shifts = shiftsAt(frames, scores, candidate);
    if (!shifts.length) break;
    if (chosen.length && quantile(shifts.map(shift => Math.hypot(shift.x, shift.y)), 0.5) > MAX_SHIFT * 0.6) break;
    chosen = shifts;
    step = candidate;
  }
  const width = frames[0]!.image.width;
  const pixelsPerSecond = quantile(chosen.map(shift => Math.hypot(shift.x, shift.y) / shift.seconds), 0.5);
  return {
    driftDegreesPerSecond: rounded((pixelsPerSecond / width) * hfov, 4),
    driftDirectionDegrees: rounded((quantile(chosen.map(shift => Math.atan2(shift.y, shift.x)), 0.5) * 180) / Math.PI,
      0),
    driftFrameWidthsPerMinute: rounded((pixelsPerSecond / width) * 60),
    driftStepSeconds: step,
    evolutionPerSecond: rounded(quantile(chosen.map(shift => shift.residual / shift.seconds), 0.5), 4),
    pairs: chosen.length
  };
};

/** Frames at most this far apart count as consecutive (flicker needs native frame steps). */
const FLICKER_PAIR_SECONDS = 0.05;

/** Luma contrast of lit cloud (90th percentile, score > 0.5) over the clear sky (median, score < 0.15). */
const cloudContrast = (image: RgbImage, score: Float32Array) => {
  const cloud: number[] = [], sky: number[] = [];
  score.forEach((value, pixel) => {
    if (value > 0.5) cloud.push(lumaAt(image, pixel));
    if (value < 0.15) sky.push(lumaAt(image, pixel));
  });
  return Math.max(1, quantile(cloud, 0.9) - quantile(sky, 0.5));
};

/**
 * Edge stability: for consecutive frames, the mean and 99th percentile of |Δ luma| over the cloud
 * edge band (score 0.2–0.8 in both frames). Drift between consecutive frames is a fraction of a
 * pixel, so what remains is fizz, sparkle and history jitter; `edgeFlickerRelative` is the mean in % of
 * the cloud-over-sky contrast (a deeper sky raises raw deltas). Empty without consecutive frames.
 */
export const edgeFlicker = (frames: readonly TimedFrame[]): Record<string, number | null> => {
  const means: number[] = [], peaks: number[] = [], contrasts: number[] = [];
  for (let index = 1; index < frames.length; index++) {
    if (frames[index]!.seconds - frames[index - 1]!.seconds > FLICKER_PAIR_SECONDS) continue;
    const before = frames[index - 1]!.image, after = frames[index]!.image;
    const a = cloudScore(before), b = cloudScore(after);
    if (!a || !b) continue;
    const deltas: number[] = [];
    a.forEach((value, pixel) => {
      const inEdge = value > 0.2 && value < 0.8 && b[pixel]! > 0.2 && b[pixel]! < 0.8;
      if (inEdge) deltas.push(Math.abs(lumaAt(after, pixel) - lumaAt(before, pixel)));
    });
    if (deltas.length < 50) continue;
    means.push(mean(deltas));
    peaks.push(quantile(deltas, 0.99));
    contrasts.push(cloudContrast(before, a));
  }
  if (!means.length) return {};
  return { edgeFlickerMean: rounded(quantile(means, 0.5)), edgeFlickerP99: rounded(quantile(peaks, 0.5), 1),
    edgeFlickerRelative: rounded((quantile(means, 0.5) / quantile(contrasts, 0.5)) * 100), flickerPairs: means.length };
};

/** Colour statistics usable on any sky (dusk, overcast): dark 20 % and bright 5 % mean colours. */
export const skyColourMetrics = (image: RgbImage) => {
  const pixels = Array.from({ length: image.width * image.height }, (_, pixel) => pixel);
  const lumas = pixels.map(pixel => lumaAt(image, pixel));
  const dark = quantile(lumas, 0.2), bright = quantile(lumas, 0.95);
  return {
    brightRgb: meanRgb(image, pixels.filter(pixel => lumas[pixel]! >= bright)),
    darkRgb: meanRgb(image, pixels.filter(pixel => lumas[pixel]! <= dark)),
    darkToBright: rounded(dark / Math.max(1, bright)),
    medianLuma: rounded(quantile(lumas, 0.5), 1)
  };
};
