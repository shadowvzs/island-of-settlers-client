import { describe, expect, it } from "vitest";

import { getRendererContextOptions } from "../src/renderers/three/renderer-context-options";

const canvas = {} as HTMLCanvasElement;

describe("renderer context options", () => {
  it("always creates an opaque canvas", () => {
    for (const target of ["off", "rgba8", "rgba16f"] as const)
      expect(getRendererContextOptions(canvas, true, target).alpha).toBe(false);
  });

  it("antialiases the canvas only on the direct path", () => {
    expect(getRendererContextOptions(canvas, true, "off").antialias).toBe(true);
    expect(getRendererContextOptions(canvas, true, "rgba8").antialias).toBe(false);
    expect(getRendererContextOptions(canvas, false, "off").antialias).toBe(false);
  });
});
