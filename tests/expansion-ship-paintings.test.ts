import { afterEach, expect, it, vi } from "vitest";

import { EXPANSION_SHIP_CLOTH } from "../src/renderers/three/settlement/expansion-ship-cloth";
import { loadShipSailArtwork } from "../src/renderers/three/settlement/ship-sail-artwork";

const context = () => {
  const calls: { image: CanvasImageSource; composition: string }[] = [];
  const mock = { globalCompositeOperation: "multiply", fillRect: vi.fn(), strokeRect: vi.fn(),
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), closePath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), drawImage: (image: CanvasImageSource) =>
      calls.push({ image, composition: mock.globalCompositeOperation }) };
  return { calls, canvas: mock as unknown as CanvasRenderingContext2D };
};
afterEach(() => vi.unstubAllGlobals());

it("paints the phoenix over Persian linen while keeping the battened Chinese sails plain red", () => {
  const phoenix = {} as CanvasImageSource, cloth = {} as CanvasImageSource;
  const persian = context(), chinese = context();
  EXPANSION_SHIP_CLOTH.persianCloth(persian.canvas, { persianPhoenix: phoenix, cloth });
  expect(persian.calls).toEqual([{ image: phoenix, composition: "source-over" },
    { image: cloth, composition: "multiply" }]);
  EXPANSION_SHIP_CLOTH.chineseCloth(chinese.canvas, { persianPhoenix: phoenix, cloth });
  expect(chinese.calls).toEqual([]);
});

it.each([true, false])("loads the matching Persian illustration LOD (High=%s)", async detailed => {
  const urls: string[] = [];
  vi.stubGlobal("Image", class {
    onload?: () => void;
    set src(url: string) { urls.push(url); queueMicrotask(() => this.onload?.()); }
  });
  const artwork = await loadShipSailArtwork(detailed);
  expect(artwork.persianPhoenix).toBeDefined();
  expect(urls.some(url => url.includes(`persian-phoenix-${detailed ? "high" : "minimal"}.webp`))).toBe(true);
  expect(urls.some(url => url.includes("chinese-rising-sun"))).toBe(false);
});
