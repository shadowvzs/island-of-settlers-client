import { describe, expect, it } from "vitest";

import { CHINESE_LANTERN_GLYPHS } from "../src/render-common/props/chinese-lantern-glyphs";
import { CHINESE_LANTERN_PROFILE, lanternInkTriangles } from "../src/render-common/props/chinese-lantern-ink";

const silkFront = (x: number, y: number, detailed: boolean) => {
  const upper = CHINESE_LANTERN_PROFILE.findIndex(point => point[1] >= y);
  const [r0, y0] = CHINESE_LANTERN_PROFILE[upper - 1]!;
  const [r1, y1] = CHINESE_LANTERN_PROFILE[upper]!;
  const radius = r0 + (r1 - r0) * (y - y0) / (y1 - y0), segments = detailed ? 48 : 12;
  for (let facet = 0; facet < segments / 2; facet++) {
    const a = facet * Math.PI * 2 / segments, b = (facet + 1) * Math.PI * 2 / segments;
    const ar = radius * (1 + .02 * Math.cos(a * 12)), br = radius * (1 + .02 * Math.cos(b * 12));
    const ax = ar * Math.cos(a), bx = br * Math.cos(b);
    if (x < bx - 1e-9 || x > ax + 1e-9) continue;
    const t = (x - ax) / (bx - ax);
    return ar * Math.sin(a) * (1 - t) + br * Math.sin(b) * t;
  }
  throw new Error("Ink outside silk");
};

describe("Chinese lantern silk lettering", () => {
  for (const detailed of [true, false]) it(`keeps all six complete glyphs above actual ${detailed ? "High" : "Minimal"} facets`, () => {
    for (const glyph of CHINESE_LANTERN_GLYPHS) {
      const triangles = lanternInkTriangles(glyph, detailed);
      expect(triangles.length).toBeGreaterThan(50);
      let inkArea = 0, projectedArea = 0;
      for (let index = 0; index < glyph.length; index += 6) {
        inkArea += Math.abs((glyph[index + 2]! - glyph[index]!) * (glyph[index + 5]! - glyph[index + 1]!) -
          (glyph[index + 3]! - glyph[index + 1]!) * (glyph[index + 4]! - glyph[index]!)) * .30 * .33 / 2;
      }
      for (const triangle of triangles) {
        const [a, b, c] = triangle;
        projectedArea += Math.abs((b![0] - a![0]) * (c![1] - a![1]) -
          (b![1] - a![1]) * (c![0] - a![0])) / 2;
        const centroid = [0, 1, 2].map(axis => triangle.reduce((sum, vertex) => sum + vertex[axis]!, 0) / 3);
        for (const point of [...triangle, centroid]) {
          expect(point[2]! - silkFront(point[0]!, point[1]!, detailed)).toBeCloseTo(.003, 7);
        }
      }
      expect(projectedArea).toBeCloseTo(inkArea, 8);
    }
  });
});
