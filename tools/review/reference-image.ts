/**
 * Pure pixel helpers of the reference tuner (TOOL-8): packed RGB images, crops, rotation so the
 * landward side points down, luma/saturation and order statistics. No I/O, so the metrics stay
 * unit-testable with synthetic frames.
 */

/** Packed 8-bit RGB (3 bytes per pixel), rows top-down. */
export interface RgbImage {
  height: number;
  pixels: Uint8Array;
  width: number;
}

/** One frame of a clip or a game strip; `seconds` is its time from the first frame. */
export interface TimedFrame {
  image: RgbImage;
  seconds: number;
}

/** A region in shares (0..1) of the frame size. */
export interface Roi {
  height: number;
  left: number;
  top: number;
  width: number;
}

/** Screen direction in which the land lies (the swash runs up towards it). */
export type Landward = "down" | "left" | "right" | "up";

export const FULL_FRAME: Roi = { height: 1, left: 0, top: 0, width: 1 };

const LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;

export const lumaAt = (image: RgbImage, pixel: number) => {
  const offset = pixel * 3;
  return image.pixels[offset]! * LUMA_WEIGHTS[0] + image.pixels[offset + 1]! * LUMA_WEIGHTS[1]
    + image.pixels[offset + 2]! * LUMA_WEIGHTS[2];
};

/** HSV-style saturation 0..1 (0 = grey or white). */
export const saturationAt = (image: RgbImage, pixel: number) => {
  const offset = pixel * 3;
  const red = image.pixels[offset]!, green = image.pixels[offset + 1]!, blue = image.pixels[offset + 2]!;
  const high = Math.max(red, green, blue);
  if (high === 0) return 0;
  return (high - Math.min(red, green, blue)) / high;
};

export const createImage = (width: number, height: number): RgbImage =>
  ({ height, pixels: new Uint8Array(width * height * 3), width });

export const cropImage = (image: RgbImage, roi: Roi): RgbImage => {
  const left = Math.round(roi.left * image.width), top = Math.round(roi.top * image.height);
  const width = Math.max(1, Math.min(image.width - left, Math.round(roi.width * image.width)));
  const height = Math.max(1, Math.min(image.height - top, Math.round(roi.height * image.height)));
  const result = createImage(width, height);
  for (let row = 0; row < height; row++) {
    const from = ((top + row) * image.width + left) * 3;
    result.pixels.set(image.pixels.subarray(from, from + width * 3), row * width * 3);
  }
  return result;
};

/** Source pixel of output (column, row) for each landward direction (output: land at the bottom). */
const SOURCE_OF: Record<Landward, (image: RgbImage, column: number, row: number) => number> = {
  down: (image, column, row) => row * image.width + column,
  left: (image, column, row) => column * image.width + (image.width - 1 - row),
  right: (image, column, row) => (image.height - 1 - column) * image.width + row,
  up: (image, column, row) => (image.height - 1 - row) * image.width + (image.width - 1 - column)
};

/** Rotates `image` so the land lies at the bottom (sea at the top): rows run landward. */
export const orientLandDown = (image: RgbImage, landward: Landward): RgbImage => {
  if (landward === "down") return image;
  const sideways = landward === "left" || landward === "right";
  const width = sideways ? image.height : image.width, height = sideways ? image.width : image.height;
  const result = createImage(width, height), source = SOURCE_OF[landward];
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    const from = source(image, column, row) * 3, to = (row * width + column) * 3;
    result.pixels[to] = image.pixels[from]!;
    result.pixels[to + 1] = image.pixels[from + 1]!;
    result.pixels[to + 2] = image.pixels[from + 2]!;
  }
  return result;
};

/** `q` quantile (0..1) of `values` by nearest rank; NaN when empty. */
export const quantile = (values: ArrayLike<number>, q: number) => {
  if (!values.length) return Number.NaN;
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))]!;
};

export const mean = (values: ArrayLike<number>) => {
  if (!values.length) return Number.NaN;
  let sum = 0;
  for (let index = 0; index < values.length; index++) sum += values[index]!;
  return sum / values.length;
};

/** Rounds for reports: 3 significant decimals, NaN kept as null (JSON-safe). */
export const rounded = (value: number, digits = 3) =>
  (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);
