import type { DataTexture } from "three";
import { expect, it } from "vitest";

import { paintBuildingSurface, surfacePaintKey } from "../src/renderers/three/buildings/building-surface-paint";
import { createSurfaceTextures, restoreSurfacePixels } from
  "../src/renderers/three/buildings/building-surface-textures";

it("releases uploaded pixels from textures and builder results, restoring identical pixels after context loss", () => {
  const paint = { detailed: true, nation: "roman", resolution: 16, surface: "stone" } as const;
  const maps = paintBuildingSurface(paint);
  const original = maps.map(map => map.slice());
  const painted = new Map([[surfacePaintKey(paint), maps]]);
  const textures = createSurfaceTextures(paint, painted) as DataTexture[];
  for (const texture of textures) texture.onUpdate!(texture);
  expect(maps.every(map => map.byteLength === 0)).toBe(true);
  expect(textures.every(texture => texture.image.data === null)).toBe(true);
  restoreSurfacePixels(painted);
  textures.forEach((texture, index) => expect(texture.image.data).toEqual(original[index]));
  for (const texture of textures) texture.dispose();
  expect(() => restoreSurfacePixels(painted)).not.toThrow();
});
