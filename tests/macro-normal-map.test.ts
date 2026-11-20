import { describe, expect, it } from "vitest";

import { createMacroNormalPixels } from "../src/render-common/macro-normal-map";

const SIZE = 8;

const createGrid = (height: (x: number, z: number) => number) => {
  const heights = new Float32Array((SIZE + 1) * (SIZE + 1));
  for (let z = 0; z <= SIZE; z += 1) {
    for (let x = 0; x <= SIZE; x += 1) heights[z * (SIZE + 1) + x] = height(x, z);
  }
  return { cellsX: SIZE, cellsZ: SIZE, heights };
};

const decode = (pixels: Uint8Array, x: number, z: number) => {
  const offset = (z * (SIZE + 1) + x) * 4;
  return [0, 1, 2, 3].map((channel) => pixels[offset + channel]! / 255);
};

describe("macro normal map", () => {
  it("points up on flat ground, one texel per vertex, full weight", () => {
    const { height, pixels, width } = createMacroNormalPixels(createGrid(() => 3));
    expect([width, height]).toEqual([SIZE + 1, SIZE + 1]);
    const [x, y, z, weight] = decode(pixels, 4, 4);
    expect(x).toBeCloseTo(0.5, 1);
    expect(y).toBeCloseTo(1, 2);
    expect(z).toBeCloseTo(0.5, 1);
    expect(weight).toBe(1);
  });

  it("leans away from a slope rising along x (45 degrees)", () => {
    const { pixels } = createMacroNormalPixels(createGrid((x) => x));
    const [x, y, z] = decode(pixels, 4, 4).map((value) => value * 2 - 1);
    expect(x).toBeCloseTo(-Math.SQRT1_2, 1);
    expect(y).toBeCloseTo(Math.SQRT1_2, 1);
    expect(z).toBeCloseTo(0, 1);
  });

  it("ignores relief smaller than its reach (a one vertex bump)", () => {
    const { pixels } = createMacroNormalPixels(
      createGrid((x, z) => (x === 4 && z === 4 ? 2 : 0))
    );
    expect(decode(pixels, 4, 4)[1]).toBeCloseTo(1, 2);
  });
});
