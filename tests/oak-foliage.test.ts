import { describe, expect, it } from "vitest";

import { createAtlasCanvas, darkenPixel } from "../src/render-common/trees/atlas-canvas";
import { type CellArea,paintLeafShadow } from "../src/render-common/trees/foliage-strokes";
import { paintOakSpray } from "../src/render-common/trees/oak-foliage";
import { createPainter } from "../src/render-common/trees/spray-painter";
import { createRandom } from "../src/shared/world/rng";

const CELL: CellArea = { height: 256, width: 256, x: 0, y: 0 };

const paintCell = (seed: number) => {
  const canvas = createAtlasCanvas(256, 256);
  paintOakSpray(createPainter(canvas, CELL, createRandom(seed), 0));
  return canvas;
};

const getCoverage = (alpha: Float32Array) =>
  alpha.reduce((sum, value) => sum + (value > 0.5 ? 1 : 0), 0) / alpha.length;

describe("oak foliage cells", () => {
  it("are deterministic per seed and differ between seeds", () => {
    expect(paintCell(3).color).toEqual(paintCell(3).color);
    expect(paintCell(4).alpha).not.toEqual(paintCell(3).alpha);
  });

  it("keep gaps between the leaves (a spray, not a solid card)", () => {
    for (const seed of [1, 2, 3]) {
      const coverage = getCoverage(paintCell(seed).alpha);
      expect(coverage).toBeGreaterThan(0.12);
      expect(coverage).toBeLessThan(0.4);
    }
  });
});

describe("leaf shadows", () => {
  it("darken painted pixels only and never add coverage", () => {
    const canvas = createAtlasCanvas(64, 64);
    canvas.alpha[32 * 64 + 32] = 1;
    canvas.color.fill(0.5);
    paintLeafShadow(
      canvas,
      { height: 64, width: 64, x: 0, y: 0 },
      {
        angle: 0,
        color: [0, 0, 0],
        layer: 0,
        length: 20,
        roundness: 0.8,
        surface: 0,
        width: 8,
        x: 24,
        y: 32
      },
      { offset: [0, 0], strength: 0.5 }
    );
    expect(canvas.color[(32 * 64 + 32) * 3]!).toBeLessThan(0.5);
    expect(canvas.color[(32 * 64 + 31) * 3]!).toBe(0.5);
    expect(getCoverage(canvas.alpha)).toBe(1 / (64 * 64));
  });

  it("darkenPixel ignores empty and out of range pixels", () => {
    const canvas = createAtlasCanvas(4, 4);
    canvas.color.fill(1);
    darkenPixel(canvas, 1, 1, 0.5);
    darkenPixel(canvas, -1, 9, 0.5);
    expect(canvas.color.every((value) => value === 1)).toBe(true);
  });
});
