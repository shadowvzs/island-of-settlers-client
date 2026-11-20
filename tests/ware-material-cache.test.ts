import { CanvasTexture, DataTexture } from "three";
import { afterEach, expect, it, vi } from "vitest";

import {
  listWareSurfacePaints,
  paintBuildingSurface,
  ROMAN_SURFACE_COLOURS,
  surfacePaintKey
} from "../src/renderers/three/buildings/building-surface-paint";
import { createSurfaceTextures } from "../src/renderers/three/buildings/building-surface-textures";
import { acquireWareMaterials } from "../src/renderers/three/settlement/ware-material-cache";

afterEach(() => vi.unstubAllGlobals());

/** Node has no canvas: just enough of one for the page-painted fallback. */
const stubCanvas = () => {
  vi.stubGlobal("ImageData", class { constructor(readonly data: Uint8ClampedArray) {} });
  vi.stubGlobal("document", {
    createElement: () => ({ getContext: () => ({ putImageData: () => {} }), height: 0, width: 0 })
  });
};

it("lists the Roman surfaces at the ware map size (256² High, 64² Minimal)", () => {
  const high = listWareSurfacePaints(true), minimal = listWareSurfacePaints(false);
  expect(high).toHaveLength(Object.keys(ROMAN_SURFACE_COLOURS).length);
  expect(high.every(paint => paint.nation === "roman" && paint.resolution === 256 && paint.detailed)).toBe(true);
  expect(minimal.every(paint => paint.resolution === 64 && !paint.detailed)).toBe(true);
});

it("shares one worker-painted pack per detail level until the last owner releases it", () => {
  const painted = new Map(listWareSurfacePaints(false).map(paint =>
    [surfacePaintKey(paint), paintBuildingSurface(paint)]));
  const renderer = acquireWareMaterials(false, painted);
  const carts = acquireWareMaterials(false);
  expect(carts.materials).toBe(renderer.materials);
  expect(renderer.materials.stone.map).toBeInstanceOf(DataTexture);
  renderer.release();
  carts.release();
  const again = acquireWareMaterials(false, painted);
  expect(again.materials).not.toBe(renderer.materials);
  again.release();
});

it("paints released prepainted maps again on the page instead of uploading empty pixels", () => {
  stubCanvas();
  const paint = { detailed: false, nation: "roman", resolution: 8, surface: "stone" } as const;
  const painted = new Map([[surfacePaintKey(paint), [new Uint8ClampedArray(0)]]]);
  const [albedo] = createSurfaceTextures(paint, painted);
  expect(albedo).toBeInstanceOf(CanvasTexture);
});
