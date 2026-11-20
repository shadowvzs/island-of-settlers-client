import { describe, expect, it } from "vitest";

import {
  getPixelRatio,
  isResolutionMode,
  resolveResolutionProfile
} from "../src/render-common/resolution";

describe("resolution setting", () => {
  it("auto caps the pixel ratio and drops MSAA only on touch devices", () => {
    expect(resolveResolutionProfile("auto", true)).toEqual({ antialias: false, maxPixelRatio: 1 });
    expect(resolveResolutionProfile("auto", false)).toEqual(
      resolveResolutionProfile("sharp", true)
    );
  });

  it("explicit modes ignore the device", () => {
    expect(resolveResolutionProfile("fast", false)).toEqual(
      resolveResolutionProfile("fast", true)
    );
    expect(resolveResolutionProfile("fast", false).antialias).toBe(false);
    expect(resolveResolutionProfile("balanced", true).maxPixelRatio).toBe(1.5);
  });

  it("caps the device ratio", () => {
    const fast = resolveResolutionProfile("fast", false);
    const sharp = resolveResolutionProfile("sharp", false);
    expect(getPixelRatio(3, fast)).toBe(1);
    expect(getPixelRatio(0.75, fast)).toBe(0.75);
    expect(getPixelRatio(3, sharp)).toBe(3);
  });

  it("recognises stored modes", () => {
    expect(isResolutionMode("balanced")).toBe(true);
    expect(isResolutionMode("ultra")).toBe(false);
    expect(isResolutionMode(null)).toBe(false);
  });
});
