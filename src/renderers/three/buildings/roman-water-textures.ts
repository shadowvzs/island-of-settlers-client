import { DataTexture, RepeatWrapping,RGBAFormat, SRGBColorSpace } from "three";

import { cachedPixelSet } from "./building-pixel-cache";

const paintWater = (size: number) => {
  const color = new Uint8Array(size * size * 4),
    normal = new Uint8Array(color.length);
  const height = (u: number, v: number) =>
    Math.sin(u * 25 + Math.sin(v * 17) * 2) * 0.45 +
    Math.sin(v * 39 + u * 13) * 0.25 +
    Math.cos(Math.hypot(u - 0.37, v - 0.55) * 75) * 0.15;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size,
        h = height(u, v),
        index = (y * size + x) * 4;
      const glint = Math.pow(Math.max(0, h), 5) * 95;
      color.set([40 + h * 13 + glint, 92 + h * 21 + glint, 94 + h * 23 + glint, 255], index);
      const dx = (height(u + 0.002, v) - height(u - 0.002, v)) * 5;
      const dy = (height(u, v + 0.002) - height(u, v - 0.002)) * 5;
      const length = Math.hypot(dx, dy, 1);
      normal.set(
        [128 - (dx / length) * 127, 128 - (dy / length) * 127, 128 + 127 / length, 255],
        index
      );
    }
  return [color, normal];
};

/** Original baked ripple color and normal maps, also embedded in exported GLBs. */
export const createRomanWaterTextures = (detailed: boolean) => {
  const size = detailed ? 256 : 64;
  const [color, normal] = cachedPixelSet(`water:${size}`, () => paintWater(size));
  const map = new DataTexture(color, size, size, RGBAFormat);
  map.colorSpace = SRGBColorSpace;
  const normalMap = new DataTexture(normal, size, size, RGBAFormat);
  for (const texture of [map, normalMap]) {
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.needsUpdate = true;
  }
  return {
    map,
    normalMap,
    dispose: () => {
      map.dispose();
      normalMap.dispose();
    }
  };
};
