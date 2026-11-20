import { describe, expect, it } from "vitest";

import { rasterizeRegion } from "../../island-of-settlers-shared/src/campaign/campaign-regions";
import { QUALITY_PRESETS } from "../src/render-common/quality";
import {
  GLINT_EDGE, GLINT_OFFSET_STRIDE, GLINT_PARAM_STRIDE, GLINT_SPARKLE, glintInstanceCounts, regionEdgeCells,
  writeGlintArea
} from "../src/renderers/three/cinematic/region-glint-layout";

const CELLS_X = 64;
const SEA_LEVEL = 1;
/** A slope above the sea on x < 30, water (sea level) beyond. */
const ground = (x: number) => Math.max(SEA_LEVEL, 3 - x * 0.1);
const circle = (centerX: number, radius: number) => Int32Array.from(rasterizeRegion(
  { shape: { centerX, centerZ: 32, kind: "circle", radius } }, CELLS_X, CELLS_X));

const layout = (cells: Int32Array, spritesPerArea: number) => {
  const capacity = spritesPerArea * 2;
  const buffers = { offsets: new Float32Array(capacity * GLINT_OFFSET_STRIDE),
    params: new Float32Array(capacity * GLINT_PARAM_STRIDE) };
  const count = writeGlintArea(buffers, 0, { cells, cellsX: CELLS_X, groundHeight: ground, spritesPerArea }, 0);
  return Array.from({ length: count }, (_, index) => ({
    kind: buffers.params[index * GLINT_PARAM_STRIDE + 2]!,
    size: buffers.params[index * GLINT_PARAM_STRIDE + 1]!,
    x: buffers.offsets[index * GLINT_OFFSET_STRIDE]!,
    y: buffers.offsets[index * GLINT_OFFSET_STRIDE + 1]!,
    z: buffers.offsets[index * GLINT_OFFSET_STRIDE + 2]!
  }));
};

describe("region glint layout (CIN6 owner review)", () => {
  it("counts sparkles and edge dots per detail level", () => {
    const cells = circle(20, 6);
    const edges = regionEdgeCells(cells, CELLS_X).length;
    for (const [quality, sprites] of [["high", 96], ["medium", 72], ["low", 48], ["minimal", 24]] as const) {
      const perArea = QUALITY_PRESETS[quality].cinematicView.glintSprites;
      expect(perArea).toBe(sprites);
      const counts = glintInstanceCounts(cells.length, edges, perArea);
      expect(counts.sparkles).toBe(Math.min(sprites, cells.length * 2));
      expect(counts.edges).toBe(Math.min(sprites, edges));
      expect(layout(cells, perArea)).toHaveLength(counts.sparkles + counts.edges);
    }
  });

  it("puts every sparkle on the surface inside the area's cells, small", () => {
    const cells = circle(20, 6);
    const inside = new Set(cells);
    for (const sparkle of layout(cells, 96).filter(entry => entry.kind === GLINT_SPARKLE)) {
      expect(inside.has(Math.floor(sparkle.z) * CELLS_X + Math.floor(sparkle.x))).toBe(true);
      expect(sparkle.y - ground(sparkle.x)).toBeCloseTo(0.05, 6);
      expect(sparkle.size).toBeLessThan(0.2);
    }
  });

  it("over water cells sits on the water surface, never in the air", () => {
    const sparkles = layout(circle(45, 5), 96).filter(entry => entry.kind === GLINT_SPARKLE);
    expect(sparkles.length).toBeGreaterThan(0);
    for (const sparkle of sparkles) expect(sparkle.y).toBeCloseTo(SEA_LEVEL + 0.05, 6);
  });

  it("outlines the area: edge dots only on boundary cells, ordered around it", () => {
    const cells = circle(20, 6);
    const boundary = new Set(regionEdgeCells(cells, CELLS_X).map(edge => edge.cell));
    const dots = layout(cells, 96).filter(entry => entry.kind === GLINT_EDGE);
    expect(dots.length).toBe(boundary.size);
    for (const dot of dots) expect(boundary.has(Math.floor(dot.z) * CELLS_X + Math.floor(dot.x))).toBe(true);
    const interior = 32 * CELLS_X + 20;
    expect(boundary.has(interior)).toBe(false);
  });
});
