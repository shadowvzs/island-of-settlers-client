import { lumaAt, quantile, type RgbImage, saturationAt } from "./reference-image";

/**
 * Shore band classification shared by the swash series and the still analysis (TOOL-8). Images are
 * oriented land-down (row index grows landward) and cropped so the bottom rows show dry sand.
 */

/** Share of the bottom rows taken as the dry sand reference. */
const DRY_ROWS = 0.1;
/** Foam is at least this far from the dry sand towards the brightest pixels (0..1). */
const FOAM_LIFT = 0.45;
/** Foam is white: at most this saturation (dusk foam carries a warm sky tint)... */
const FOAM_SATURATION = 0.35;
/** ...and at most this share of the dry sand's saturation (pale cartoon sand is bright too). */
const FOAM_SAND_SATURATION = 0.6;
/** Below this brightness gap between dry sand and the brightest pixels there is no readable foam. */
const MIN_FOAM_CONTRAST = 12;
/** Below this luma gap between dry sand and the darkest sand row there is no wet band. */
const MIN_WET_CONTRAST = 3;

export interface ShoreThresholds {
  /** Median luma of the dry sand rows. */
  dryLuma: number;
  /** Highest saturation of a foam pixel. */
  foamSaturation: number;
  /** Luma above which a low-saturation pixel counts as foam; NaN when the clip has no foam. */
  foamLuma: number;
}

type PixelMeasure = (image: RgbImage, pixel: number) => number;

const sample = (images: readonly RgbImage[], firstRow: (image: RgbImage) => number, stride: number,
  measure: PixelMeasure) => {
  const values: number[] = [];
  for (const image of images) for (let row = firstRow(image); row < image.height; row++)
    for (let column = 0; column < image.width; column += stride)
      values.push(measure(image, row * image.width + column));
  return values;
};

/** Dry sand and foam levels of a set of land-down images (a clip's frames or one still). */
export const shoreThresholds = (images: readonly RgbImage[]): ShoreThresholds => {
  const sampled = images.filter((_, index) => index % Math.max(1, Math.floor(images.length / 24)) === 0);
  const dryRows = (image: RgbImage) => Math.floor(image.height * (1 - DRY_ROWS));
  const dryLuma = quantile(sample(sampled, dryRows, 2, lumaAt), 0.5);
  const drySaturation = quantile(sample(sampled, dryRows, 2, saturationAt), 0.5);
  const brightest = quantile(sample(sampled, () => 0, 3, lumaAt), 0.995);
  const foamLuma = brightest - dryLuma < MIN_FOAM_CONTRAST ? Number.NaN
    : dryLuma + (brightest - dryLuma) * FOAM_LIFT;
  return { dryLuma, foamLuma, foamSaturation: Math.min(FOAM_SATURATION, drySaturation * FOAM_SAND_SATURATION) };
};

/** Foam mask of one image: bright and white, kept only where 2 of 3 vertical neighbours agree. */
export const foamMask = (image: RgbImage, thresholds: ShoreThresholds) => {
  const { height, width } = image, raw = new Uint8Array(width * height), mask = new Uint8Array(width * height);
  if (!Number.isFinite(thresholds.foamLuma)) return mask;
  for (let pixel = 0; pixel < raw.length; pixel++)
    raw[pixel] = lumaAt(image, pixel) >= thresholds.foamLuma && saturationAt(image, pixel) <= thresholds.foamSaturation
      ? 1 : 0;
  for (let row = 1; row < height - 1; row++) for (let column = 0; column < width; column++) {
    const pixel = row * width + column;
    mask[pixel] = raw[pixel - width]! + raw[pixel]! + raw[pixel + width]! >= 2 ? 1 : 0;
  }
  return mask;
};

/** Landward-most foam row of `column` above the dry reference rows; -1 when the column has none. */
export const frontRow = (mask: Uint8Array, width: number, height: number, column: number) => {
  for (let row = Math.floor(height * (1 - DRY_ROWS)) - 1; row >= 0; row--)
    if (mask[row * width + column]) return row;
  return -1;
};

/** Foam rows seaward of `front` (one-row gaps bridged): the foam line's thickness. */
export const foamWidthAt = (mask: Uint8Array, width: number, column: number, front: number) => {
  let rows = 0;
  for (let row = front; row >= 0; row--) {
    if (mask[row * width + column]) { rows = front - row + 1; continue; }
    if (row > 0 && mask[(row - 1) * width + column]) continue;
    break;
  }
  return rows;
};

/** Median luma per row of the non-foam pixels of all images: the eye's average across-shore profile. */
export const rowProfile = (images: readonly RgbImage[], masks: readonly Uint8Array[]) => {
  const { height, width } = images[0]!;
  const profile = new Float64Array(height);
  for (let row = 0; row < height; row++) {
    const values: number[] = [];
    images.forEach((image, index) => {
      for (let column = 0; column < width; column += 2) {
        const pixel = row * width + column;
        if (!masks[index]![pixel]) values.push(lumaAt(image, pixel));
      }
    });
    profile[row] = values.length ? quantile(values, 0.5) : Number.NaN;
  }
  return profile;
};

/**
 * Landward edge of the wet band: scanning seaward from the dry reference, the first row darker
 * than halfway between dry sand and the darkest sand row at or landward of `seawardLimit` (the
 * highest run-up or the foam line). Returns `seawardLimit` when there is no readable wet band.
 */
export const dryEdgeRow = (profile: Float64Array, dryLuma: number, seawardLimit: number) => {
  const dryStart = Math.floor(profile.length * (1 - DRY_ROWS));
  const wetLuma = Math.min(...Array.from(profile.subarray(Math.max(0, Math.round(seawardLimit)), dryStart))
    .filter(Number.isFinite));
  if (!(dryLuma - wetLuma >= MIN_WET_CONTRAST)) return Math.round(seawardLimit);
  const middle = (dryLuma + wetLuma) / 2;
  for (let row = dryStart - 1; row >= 0; row--)
    if (profile[row]! < middle) return row + 1;
  return 0;
};

/** Sand coloured (red ≥ green ≥ blue, warm): wet or dry sand, or sand seen through a thin sheet. */
const isSandHued = (image: RgbImage, pixel: number) => {
  const red = image.pixels[pixel * 3]!, green = image.pixels[pixel * 3 + 1]!, blue = image.pixels[pixel * 3 + 2]!;
  return red >= green && green >= blue && red - blue > 15;
};

/** Median luma of the sand-hued, foam-free pixels of rows [from, to) over all images. */
export const sandLumaBetween = (images: readonly RgbImage[], masks: readonly Uint8Array[], from: number,
  to: number) => {
  const values: number[] = [];
  images.forEach((image, index) => {
    for (let row = Math.max(0, Math.round(from)); row < Math.min(image.height, Math.round(to)); row++)
      for (let column = 0; column < image.width; column += 2) {
        const pixel = row * image.width + column;
        if (!masks[index]![pixel] && isSandHued(image, pixel)) values.push(lumaAt(image, pixel));
      }
  });
  return values.length >= 20 ? quantile(values, 0.5) : Number.NaN;
};

/** Median of `profile` over rows [from, to); NaN for an empty range. */
export const profileMedian = (profile: Float64Array, from: number, to: number) => {
  const start = Math.max(0, Math.round(from)), end = Math.min(profile.length, Math.round(to));
  const values = Array.from(profile.subarray(start, Math.max(start, end))).filter(Number.isFinite);
  return quantile(values, 0.5);
};
