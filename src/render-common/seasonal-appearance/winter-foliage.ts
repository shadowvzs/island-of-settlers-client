import type { AtlasMip } from "../baker/atlas-mips";
import { createPeriodicNoise } from "../materials/periodic-noise";
import { SNOW_PALETTE } from "../snow-palette";
import type { PaintedTexture } from "../trees/atlas-canvas";
import { getWinterFoliageKind } from "./winter-foliage-kind";

const winterAtlases = new WeakMap<PaintedTexture, PaintedTexture>();
const frostNoise = createPeriodicNoise(1977);
const DRY = [.64, .45, .26] as const;
const EVERGREEN = [.81, .9, .94] as const;
const SNOW = SNOW_PALETTE.winterFoliageSnow;

/** Original coverage/normal maps and mip layouts remain exact; only the albedo RGB is seasonal. */
const paintWinterColors = (color: Uint8Array, normal: Uint8Array, width: number, height: number) => {
  const result = color.slice();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4, u = (x + .5) / width, v = (y + .5) / height;
    const evergreen = getWinterFoliageKind(u, v) === "evergreen";
    const r = color[offset]!, g = color[offset + 1]!, b = color[offset + 2]!;
    if (r + g + b === 0) continue;
    const luminance = r * .3 + g * .59 + b * .11;
    if (!evergreen) {
      for (let channel = 0; channel < 3; channel++)
        result[offset + channel] = Math.round(Math.min(255, DRY[channel]! * (65 + luminance)));
      continue;
    }
    const ridge = Math.max(0, (normal[offset + 1]! - 127.5) / 127.5);
    const patch = frostNoise.gradient(u, v, 58);
    const snow = Math.max(0, Math.min(.72, (patch + .1 + ridge * .45) * 1.5));
    for (let channel = 0; channel < 3; channel++) {
      const winter = color[offset + channel]! * EVERGREEN[channel]!;
      result[offset + channel] = Math.round(winter + (SNOW[channel]! - winter) * snow);
    }
  }
  return result;
};

/** Cached CPU variant for the existing atlas and its existing mip chain; shader/sampler layout is unchanged. */
export const getWinterFoliageAtlas = (source: PaintedTexture): PaintedTexture => {
  const cached = winterAtlases.get(source);
  if (cached) return cached;
  const color = paintWinterColors(source.color, source.normal, source.width, source.height);
  const colorMips = source.colorMips?.map((mip, level): AtlasMip => {
    if (level === 0) return { ...mip, data: color };
    const normal = source.normalMips?.[level]?.data;
    // Existing atlases provide matched normal mips; a missing one has a flat tangent normal.
    const flat = normal ?? new Uint8Array(mip.data.length).fill(128);
    return { ...mip, data: paintWinterColors(mip.data, flat, mip.width, mip.height) };
  });
  const result = { ...source, color, colorMips };
  winterAtlases.set(source, result);
  return result;
};
