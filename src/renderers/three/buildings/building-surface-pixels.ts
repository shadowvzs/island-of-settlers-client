import { createRomanTextureGrain } from "./roman-texture-grain";
import type { SurfaceSampler } from "./surface-detail-common";

type Colour = readonly [number, number, number];
type TextureGrain = ReturnType<typeof createRomanTextureGrain>;

/** RGBA pixels of one surface: albedo, then (detailed) normal and roughness; rows top to bottom. */
export type SurfacePixels = Uint8ClampedArray<ArrayBuffer>[];

/** The last grain built: a pack paints every surface at one resolution (no DOM, worker safe). */
let grainCache: { grain: TextureGrain; resolution: number } | undefined;

const grainFor = (resolution: number) => {
  if (grainCache?.resolution !== resolution)
    grainCache = { grain: createRomanTextureGrain(resolution), resolution };
  return grainCache.grain;
};

/** Albedo (and roughness) per texel; returns the heights the normal map is derived from. */
const paintAlbedo = (
  sample: SurfaceSampler,
  base: Colour,
  resolution: number,
  maps: SurfacePixels,
  detailed: boolean
) => {
  const { grain, mineral, weather } = grainFor(resolution);
  const [albedo, , roughness] = maps;
  const heights = new Float32Array(resolution * resolution);
  for (let y = 0; y < resolution; y++)
    for (let x = 0; x < resolution; x++) {
      const index = y * resolution + x;
      const detail = sample({
        grain: grain[index]!,
        mineral: mineral[index]!,
        u: x / resolution,
        v: y / resolution,
        weather: weather[index]!
      });
      heights[index] = detail.height;
      const offset = index * 4;
      for (let c = 0; c < 3; c++) {
        albedo![offset + c] = Math.max(0, base[c]! * detail.brightness * detail.colour[c]!);
        if (detailed) roughness![offset + c] = detail.roughness;
      }
      albedo![offset + 3] = 255;
      if (detailed) roughness![offset + 3] = 255;
    }
  return heights;
};

/** Tangent-space normals from the tileable height field (wrapped neighbours). */
const paintNormals = (heights: Float32Array, resolution: number, normal: Uint8ClampedArray) => {
  const at = (x: number, y: number) =>
    heights[((y + resolution) % resolution) * resolution + ((x + resolution) % resolution)]!;
  // Height steps are per texel: scale by resolution so every map size gets the same relief.
  const strength = 2 * resolution / 1024;
  for (let y = 0; y < resolution; y++)
    for (let x = 0; x < resolution; x++) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const ny = (at(x, y - 1) - at(x, y + 1)) * strength;
      const length = Math.hypot(nx, ny, 1),
        offset = (y * resolution + x) * 4;
      normal.set(
        [(nx / length + 1) * 127.5, (ny / length + 1) * 127.5, (1 / length + 1) * 127.5, 255],
        offset
      );
    }
};

/**
 * Original deterministic tileable PBR maps (albedo, then High normal and roughness) from one
 * sampler, as plain pixels: painted in a world worker for the game, on the page for the tools.
 */
export const paintSurfacePixels = (
  sample: SurfaceSampler,
  base: Colour,
  resolution: number,
  detailed: boolean
): SurfacePixels => {
  const maps = Array.from({ length: detailed ? 3 : 1 }, () =>
    new Uint8ClampedArray(resolution * resolution * 4));
  const heights = paintAlbedo(sample, base, resolution, maps, detailed);
  if (detailed) paintNormals(heights, resolution, maps[1]!);
  return maps;
};
