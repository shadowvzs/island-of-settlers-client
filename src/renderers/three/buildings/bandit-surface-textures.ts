import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace
} from "three";

import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import { sinHash2 } from "../../../shared/world/noise";

/** Original rough salvage surfaces; no national roof, brickwork or board atlas is reused. */
export const createBanditSurfaceTextures = (surface: BuildingSurface, detailed: boolean) => {
  const size = detailed ? 128 : 64;
  const pixels = new Uint8Array(size * size * 4);
  const relief = new Uint8Array(pixels.length);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size;
      let value = 0.8 + sinHash2(x, y) * 0.04;
      if (["wood", "bark", "planks"].includes(surface)) {
        const wave = u * 19 + Math.sin(v * Math.PI * 4) * 0.13;
        value -= Math.pow(Math.abs(Math.sin(wave * Math.PI)), 16) * 0.22;
        if (surface === "planks" && Math.floor(u * 7) !== Math.floor((u - 0.015) * 7))
          value *= 0.55;
      } else if (surface === "stone") {
        const row = Math.floor(v * 6),
          offset = sinHash2(row, 7) * 0.4;
        const joint = (u * 5 + offset) % 1;
        if (joint < 0.055 || (v * 6) % 1 < 0.07) value *= 0.55;
        else value *= 0.78 + sinHash2(Math.floor(u * 5 + offset), row) * 0.25;
      } else if (surface === "cloth" || surface === "rope" || surface === "roof-thatch") {
        value += Math.sin((x * Math.PI) / 2) * 0.045 + Math.sin((y * Math.PI) / 2) * 0.035;
        if (surface === "roof-thatch")
          value -= Math.pow(Math.abs(Math.sin(u * Math.PI * 26)), 10) * 0.18;
      } else if (surface === "roof-shingles") {
        const row = Math.floor(v * 8),
          joint = (u * 6 + (row % 2) * 0.5) % 1;
        if (joint < 0.045 || (v * 8) % 1 < 0.08) value *= 0.5;
        else value *= 0.7 + sinHash2(Math.floor(u * 6), row) * 0.3;
      }
      const shade = Math.round(Math.max(0, Math.min(1, value)) * 255);
      const index = (y * size + x) * 4;
      pixels.set([shade, Math.round(shade * 0.97), Math.round(shade * 0.9), 255], index);
      relief.set([shade, shade, shade, 255], index);
    }
  const map = new DataTexture(pixels, size, size),
    bump = new DataTexture(relief, size, size);
  map.colorSpace = SRGBColorSpace;
  for (const texture of [map, bump]) {
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.needsUpdate = true;
  }
  return [map, bump] as const;
};
