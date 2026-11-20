import { type RgbImage } from "./reference-image";

/**
 * Diagnostic overlays of the reference tuner (TOOL-8): what the metrics detected, drawn on a copy
 * of the analysed (cropped, land-down) frame, so a wrong ROI or threshold is visible on the sheet.
 */

type Rgb = readonly [number, number, number];

const FOAM_TINT: Rgb = [0, 200, 255];
const FRONT_COLOUR: Rgb = [255, 40, 40];
const LINE_COLOURS = { dryEdge: [255, 220, 0] as Rgb, reachHigh: [255, 0, 255] as Rgb, reachLow: [0, 255, 80] as Rgb,
  sheet: [255, 140, 0] as Rgb };

const paint = (image: RgbImage, pixel: number, colour: Rgb, share = 1) => {
  for (let channel = 0; channel < 3; channel++) {
    const offset = pixel * 3 + channel;
    image.pixels[offset] = Math.round(image.pixels[offset]! * (1 - share) + colour[channel]! * share);
  }
};

export interface SwashOverlay {
  /** Landward-most foam row per column (-1 none). */
  fronts: number[];
  /** Rows of the clip-wide lines and this frame's moving sheet edge (NaN = not drawn). */
  lines: Record<keyof typeof LINE_COLOURS, number>;
  mask: Uint8Array;
}

/**
 * Foam tinted cyan, the detected front red; dashed: run-up range (green low, magenta high), dry edge
 * (yellow) and the frame's moving sheet edge (orange).
 */
export const drawSwashOverlay = (source: RgbImage, overlay: SwashOverlay): RgbImage => {
  const image: RgbImage = { ...source, pixels: new Uint8Array(source.pixels) };
  overlay.mask.forEach((foam, pixel) => { if (foam) paint(image, pixel, FOAM_TINT, 0.35); });
  for (const [name, row] of Object.entries(overlay.lines)) {
    if (!Number.isFinite(row)) continue;
    const at = Math.min(image.height - 1, Math.max(0, Math.round(row)));
    for (let column = 0; column < image.width; column++)
      if (column % 6 < 4) paint(image, at * image.width + column, LINE_COLOURS[name as keyof typeof LINE_COLOURS]);
  }
  overlay.fronts.forEach((row, column) => {
    if (row >= 0) paint(image, row * image.width + column, FRONT_COLOUR);
  });
  return image;
};

/** Analysis pixels of the edge crop (before the zoom). */
const EDGE_CROP = { height: 30, width: 48, zoom: 4 };

const zoomCrop = (image: RgbImage, left: number, top: number, pixel: (offset: number) => Rgb) => {
  const { height, width, zoom } = EDGE_CROP;
  const result: RgbImage = { height: height * zoom, pixels: new Uint8Array(width * height * zoom * zoom * 3),
    width: width * zoom };
  for (let row = 0; row < result.height; row++) for (let column = 0; column < result.width; column++) {
    const source = (top + Math.floor(row / zoom)) * image.width + left + Math.floor(column / zoom);
    result.pixels.set(pixel(source), (row * result.width + column) * 3);
  }
  return result;
};

/**
 * Zoomed (×4, nearest) crop of the cloud edge densest region: frame A, frame B and |B − A| × 8, side by
 * side. `edge` marks edge-band pixels of frame A (cloud score 0.2–0.8).
 */
export const drawEdgeCrops = (a: RgbImage, b: RgbImage, edge: Uint8Array): RgbImage => {
  let best = { count: -1, left: 0, top: 0 };
  for (let top = 0; top + EDGE_CROP.height <= a.height; top += 6)
    for (let left = 0; left + EDGE_CROP.width <= a.width; left += 8) {
      let count = 0;
      for (let row = top; row < top + EDGE_CROP.height; row += 2)
        for (let column = left; column < left + EDGE_CROP.width; column += 2)
          count += edge[row * a.width + column]!;
      if (count > best.count) best = { count, left, top };
    }
  const rgb = (image: RgbImage) => (offset: number): Rgb =>
    [image.pixels[offset * 3]!, image.pixels[offset * 3 + 1]!, image.pixels[offset * 3 + 2]!];
  const diff = (offset: number): Rgb => {
    const value = Math.min(255, 8 * Math.max(...[0, 1, 2].map(channel =>
      Math.abs(b.pixels[offset * 3 + channel]! - a.pixels[offset * 3 + channel]!))));
    return [value, value, value];
  };
  const parts = [rgb(a), rgb(b), diff].map(pixel => zoomCrop(a, best.left, best.top, pixel));
  const width = parts[0]!.width, height = parts[0]!.height;
  const strip: RgbImage = { height, pixels: new Uint8Array(width * 3 * height * 3), width: width * 3 };
  parts.forEach((part, index) => {
    for (let row = 0; row < height; row++)
      strip.pixels.set(part.pixels.subarray(row * width * 3, (row + 1) * width * 3),
        (row * strip.width + index * width) * 3);
  });
  return strip;
};
