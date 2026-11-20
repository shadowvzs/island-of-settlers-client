import { describe, expect, it } from "vitest";

import { cloudShapeMetrics, estimateShift } from "../tools/review/reference-cloud-metrics";
import { createImage, orientLandDown, type RgbImage, type TimedFrame } from "../tools/review/reference-image";
import { analyseSwash, swashCycles } from "../tools/review/reference-swash-metrics";

const fill = (image: RgbImage, pixel: number, rgb: readonly number[]) => image.pixels.set(rgb, pixel * 3);

/** Front row of a synthetic swash: uprush 2 s, backwash 3 s, rest 1 s (period 6 s), rows 20 → 60. */
const frontAt = (seconds: number) => {
  const phase = seconds % 6;
  if (phase < 2) return 20 + 40 * (1 - (1 - phase / 2) ** 2);
  if (phase < 5) return 60 - 40 * ((phase - 2) / 3) ** 2;
  return 20;
};

/** Sea at the top, a 3-row foam line at the front, wet sand to row 70, dry sand below. */
const swashFrame = (seconds: number): TimedFrame => {
  const image = createImage(40, 100), front = Math.round(frontAt(seconds));
  for (let row = 0; row < 100; row++) for (let column = 0; column < 40; column++) {
    const pixel = row * 40 + column;
    if (row < front - 2) fill(image, pixel, [40, 120, 110]);
    else if (row <= front) fill(image, pixel, [240, 240, 240]);
    else fill(image, pixel, row < 70 ? [150, 125, 95] : [200, 170, 130]);
  }
  return { image, seconds };
};

describe("reference tuner metrics", () => {
  it("rotates images so the land lies at the bottom", () => {
    const image = createImage(2, 1);
    fill(image, 0, [10, 10, 10]);
    fill(image, 1, [200, 200, 200]);
    const rotated = orientLandDown(image, "right");
    expect([rotated.width, rotated.height]).toEqual([1, 2]);
    expect(rotated.pixels[3]).toBe(200);
    expect(orientLandDown(image, "left").pixels[3]).toBe(10);
  });

  it("measures swash timing and bands of a synthetic beach", () => {
    const frames = Array.from({ length: 240 }, (_, index) => swashFrame(index / 10));
    const { metrics } = analyseSwash(frames, 10);
    expect(metrics.swashPeriodSeconds).toBeCloseTo(6, 0);
    expect(metrics.swashUprushSeconds).toBeGreaterThan(1.5);
    expect(metrics.swashUprushSeconds).toBeLessThan(2.5);
    expect(metrics.swashBackwashSeconds).toBeGreaterThan(2);
    expect(metrics.foamFrontContinuity).toBe(1);
    expect(metrics.foamFrontGapsPer100Columns).toBe(0);
    expect(metrics.wetBandDarkness).toBeLessThan(0.8);
  });

  it("finds no cycles in a still series", () => {
    expect(swashCycles(Array.from({ length: 50 }, () => 10), Array.from({ length: 50 }, (_, i) => i / 5), 5))
      .toEqual([]);
  });

  it("recovers a global shift and a white cloud on a blue sky", () => {
    const width = 64, height = 48, a = new Float32Array(width * height), b = new Float32Array(width * height);
    const pattern = (x: number, y: number) => Math.sin(x * 0.4) * Math.cos(y * 0.3) + Math.sin((x + y) * 0.17);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      a[y * width + x] = pattern(x, y);
      b[y * width + x] = pattern(x - 3, y + 2);
    }
    const shift = estimateShift(a, b, width, height);
    expect(shift.dx).toBeCloseTo(3, 0);
    expect(shift.dy).toBeCloseTo(-2, 0);
    const sky = createImage(width, height);
    for (let pixel = 0; pixel < width * height; pixel++) {
      const inside = Math.hypot((pixel % width) - 32, Math.floor(pixel / width) - 24) < 10;
      fill(sky, pixel, inside ? [235, 235, 240] : [60, 120, 220]);
    }
    const metrics = cloudShapeMetrics(sky, 60)!;
    expect(metrics.cloudShare).toBeCloseTo((Math.PI * 100) / (width * height), 1);
    expect(metrics.bodyToSky).toBeGreaterThan(1.5);
  });
});
