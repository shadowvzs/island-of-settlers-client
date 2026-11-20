import { describe, expect, it } from "vitest";

import {
  isWebGpuChoice,
  readRendererChoice,
  RENDERER_CHOICES
} from "../src/render-common/renderer-choice";

describe("WG-0 renderer choice", () => {
  it("keeps WebGL as the default and accepts the two WebGPU switches", () => {
    expect(readRendererChoice(null)).toBe("webgl");
    expect(readRendererChoice("")).toBe("webgl");
    expect(readRendererChoice("unknown")).toBe("webgl");
    expect(readRendererChoice("webgl")).toBe("webgl");
    expect(readRendererChoice("webgpu")).toBe("webgpu");
    expect(readRendererChoice("webgpu-gl")).toBe("webgpu-gl");
  });

  it("only treats the WebGPU choices as node-renderer mode", () => {
    expect(RENDERER_CHOICES.map(isWebGpuChoice)).toEqual([false, true, true]);
  });
});
