import { describe, expect, it } from "vitest";

import { comparePngs, decodePng } from "../tools/bench/png-diff";
import { encodePng } from "../tools/dev/png";

const rgba = (colors: [number, number, number, number][]) => new Uint8Array(colors.flat());

describe("PNG parity helper", () => {
  it("decodes an encoded RGBA image and finds identical pixels", () => {
    const source = rgba([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [10, 20, 30, 40]]);
    const image = decodePng(encodePng(2, 2, source));
    expect([image.width, image.height]).toEqual([2, 2]);
    expect([...image.rgba]).toEqual([...source]);
    expect(comparePngs(image, image)).toMatchObject({ changedPixels: 0, maximumChannelDelta: 0 });
  });

  it("reports the changed pixels and the largest channel delta", () => {
    const left = decodePng(encodePng(1, 1, rgba([[10, 20, 30, 255]])));
    const right = decodePng(encodePng(1, 1, rgba([[10, 25, 30, 255]])));
    expect(comparePngs(left, right)).toEqual({
      changedPixels: 1,
      meanChannelDelta: 5 / 3,
      maximumChannelDelta: 5,
      pixels: 1
    });
  });

  it("rejects images of different sizes", () => {
    const left = decodePng(encodePng(1, 1, rgba([[0, 0, 0, 255]])));
    const right = decodePng(encodePng(2, 1, rgba([[0, 0, 0, 255], [0, 0, 0, 255]])));
    expect(() => comparePngs(left, right)).toThrow("Sizes differ");
  });
});
