import { afterEach, describe, expect, it } from "vitest";

import type { BuildingSurfacePaint } from "../src/render-common/content-builders";
import { setRetainTextureSource } from "../src/render-common/texture-source-retention";
import { surfacePaintKey } from "../src/renderers/three/buildings/building-surface-paint";
import { createSurfaceTextures, type PaintedSurfaces } from "../src/renderers/three/buildings/building-surface-textures";

const paint = {
  detailed: false,
  nation: "roman",
  resolution: 4,
  surface: "roof"
} as BuildingSurfacePaint;

const pixels = () => new Uint8ClampedArray(4 * 4 * 4).fill(128);
const painted = (): PaintedSurfaces => new Map([
  [surfacePaintKey(paint), [pixels(), pixels(), pixels()]]
]);

describe("WebGPU building texture source retention", () => {
  afterEach(() => setRetainTextureSource(false));

  it("keeps the worker pixels for the WebGPU upload when enabled", () => {
    setRetainTextureSource(true);
    const source = painted();
    const textures = createSurfaceTextures(paint, source);
    expect(textures[0]!.userData.webgpuSourcePixels).toBe(source.get(surfacePaintKey(paint))![0]);
    expect((textures[0]!.image as { data?: unknown }).data).not.toBeNull();
    textures.forEach(texture => texture.dispose());
  });

  it("releases the source when the presenter no longer needs it", () => {
    setRetainTextureSource(false);
    const source = painted();
    const textures = createSurfaceTextures(paint, source);
    expect(textures[0]!.userData.webgpuSourcePixels).toBeUndefined();
    textures.forEach(texture => texture.dispose());
  });
});
