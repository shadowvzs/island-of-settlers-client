import { expect, it } from "vitest";

import { createFinishedMillSailTexture } from "../src/renderers/three/buildings/mill-sail-cloth";
import { createFinishedMillSail, millSailEdgeContact } from "../src/renderers/three/buildings/mill-sail-finish";

it("finishes irregular tips within their authored envelope with normalized UVs on both LODs", () => {
  const outline = [[0, .35], [.33, 1.85], [-.11, 1.94]] as const;
  for (const detailed of [true, false]) {
    const result = createFinishedMillSail(outline, detailed);
    try {
      result.geometry.computeBoundingBox();
      expect(result.geometry.boundingBox!.min.x).toBeGreaterThanOrEqual(-.111);
      expect(result.geometry.boundingBox!.max.x).toBeLessThanOrEqual(.331);
      expect(result.geometry.boundingBox!.max.y).toBeLessThanOrEqual(1.941);
      expect(result.outline.length).toBeGreaterThan(3);
      const uv = result.geometry.getAttribute("uv");
      expect(Array.from(uv.array).every(value => Number.isFinite(value) && value >= -.00001 && value <= 1.00001)).toBe(true);
    } finally { result.geometry.dispose(); }
  }
});

it("keeps a subtle bound edge without visible dash stitching on either quality", () => {
  const outline = [[0, 0], [1, 0], [0, 1]] as const;
  for (const detailed of [true, false]) {
    const texture = createFinishedMillSailTexture(outline, detailed, () => [235, 225, 205], "test-plain");
    try {
      const pixels = texture.image.data!, size = texture.image.width;
      const red = (x: number, y: number) => pixels[(Math.round(y * (size - 1)) * size
        + Math.round(x * (size - 1))) * 4]!;
      expect(red(.5, .5)).toBeLessThan(220);
      expect(red(.3, .3)).toBe(235);
      const stitchRow = Math.round(.025 * (size - 1));
      const shades = Array.from({ length: size - 20 }, (_, x) => pixels[(stitchRow * size + x + 10) * 4]);
      expect(shades).not.toContain(99); expect(shades).toContain(235);
    } finally { texture.dispose(); }
  }
});

it("measures actual sloping hems rather than a rectangular texture border", () => {
  const outline = [[0, 0], [1, 0], [0, 1]] as const;
  expect(millSailEdgeContact(outline, .5, .5).distance).toBeCloseTo(0);
  expect(millSailEdgeContact(outline, .3, .3).distance).toBeGreaterThan(.28);
  expect(millSailEdgeContact(outline, .98, .01).distance).toBeLessThan(.02);
});

it("rounds the full outer cap rather than leaving a square top with tiny bevelled corners", () => {
  for (const detailed of [true, false]) {
    const sail = createFinishedMillSail([[0, .68], [.4, .68], [.4, 1.9], [0, 1.9]], detailed);
    try {
      const tip = sail.outline.filter(point => point[1] > 1.88);
      expect(tip.length).toBeGreaterThan(0);
      expect(Math.max(...tip.map(point => point[0])) - Math.min(...tip.map(point => point[0])))
        .toBeLessThan(.25);
    } finally { sail.geometry.dispose(); }
  }
});
