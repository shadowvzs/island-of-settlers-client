import {
  DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat,
  SRGBColorSpace, UnsignedByteType
} from "three";

import { ornamentalNoise } from "../../../render-common/plants/ornamental-tree-graph";

const noiseField = (frequency: number, seed: number) => {
  const samples = new Float64Array(frequency * frequency);
  for (let y = 0; y < frequency; y++) for (let x = 0; x < frequency; x++)
    samples[y * frequency + x] = ornamentalNoise(x * 131 + y * 997 + seed);
  return (x: number, y: number) => {
    const a = x * frequency, b = y * frequency, ix = Math.floor(a), iy = Math.floor(b);
    const u = a - ix, v = b - iy, sx = u * u * (3 - 2 * u), sy = v * v * (3 - 2 * v);
    const x0 = (ix % frequency + frequency) % frequency, x1 = (x0 + 1) % frequency;
    const y0 = (iy % frequency + frequency) % frequency, y1 = (y0 + 1) % frequency;
    const lower = samples[y0 * frequency + x0]! * (1 - sx) + samples[y0 * frequency + x1]! * sx;
    const upper = samples[y1 * frequency + x0]! * (1 - sx) + samples[y1 * frequency + x1]! * sx;
    return lower * (1 - sy) + upper * sy;
  };
};

// Bounded immutable CPU fields avoid millions of repeated hashes while painting a map pack.
const soilCoarse = noiseField(13, 73), soilFine = noiseField(93, 211);
const leafMottle = noiseField(21, 311), clayCoarse = noiseField(7, 91), clayFine = noiseField(29, 173);
const soilHumus = noiseField(31, 419);

// Free random placement and several grain sizes avoid the rejected cell grid and angular tiles.
// Paint this small CPU field once; maps and physical soil then use the exact same aggregate relief.
const soilAggregateField = (() => {
  const field = new Float32Array(256 * 256);
  for (let grain = 0; grain < 3600; grain++) {
    const seed = grain * 97 + 1237;
    const cx = ornamentalNoise(seed) * 255, cy = ornamentalNoise(seed + 19) * 255;
    const large = grain < 1100;
    const radius = large ? 1.7 + ornamentalNoise(seed + 37) * 3.5 : .65 + ornamentalNoise(seed + 37) * 1.1;
    const ratio = .48 + ornamentalNoise(seed + 53) * .65;
    const extent = radius * Math.max(1, ratio);
    const angle = ornamentalNoise(seed + 71) * Math.PI * 2, cosine = Math.cos(angle), sine = Math.sin(angle);
    const amplitude = large ? .34 + ornamentalNoise(seed + 89) * .46 : .12 + ornamentalNoise(seed + 89) * .28;
    for (let y = Math.max(0, Math.floor(cy - extent)); y <= Math.min(255, Math.ceil(cy + extent)); y++)
      for (let x = Math.max(0, Math.floor(cx - extent)); x <= Math.min(255, Math.ceil(cx + extent)); x++) {
        const dx = x - cx, dy = y - cy;
        const across = (dx * cosine + dy * sine) / radius;
        const along = (-dx * sine + dy * cosine) / (radius * ratio);
        const distance = across * across + along * along;
        if (distance >= 1) continue;
        const height = amplitude * (1 - distance) ** 1.45;
        const index = y * 256 + x;
        field[index] = Math.min(1, field[index]! + height * (1 - field[index]! * .7));
      }
  }
  return field;
})();
const soilGranule = (u: number, v: number) => {
  const x = Math.max(0, Math.min(255, u * 255)), y = Math.max(0, Math.min(255, v * 255));
  const ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
  const nextX = Math.min(255, ix + 1), nextY = Math.min(255, iy + 1);
  const lower = soilAggregateField[iy * 256 + ix]! * (1 - tx) + soilAggregateField[iy * 256 + nextX]! * tx;
  const upper = soilAggregateField[nextY * 256 + ix]! * (1 - tx) + soilAggregateField[nextY * 256 + nextX]! * tx;
  return lower * (1 - ty) + upper * ty;
};
const soilRelief = (u: number, v: number, granule: number) =>
  .12 + Math.sqrt(granule) * .52 + soilCoarse(u, v) * .18 + soilFine(u, v) * .12;

/** Original small earthy granules and open pore gaps, shared by maps and the real soil surface. */
export const shrubSoilHeight = (u: number, v: number) => soilRelief(u, v, soilGranule(u, v));

const texture = (pixels: Uint8Array, size: number, colour = false, repeat = false) => {
  const result = new DataTexture(pixels, size, size, RGBAFormat, UnsignedByteType);
  if (colour) result.colorSpace = SRGBColorSpace;
  if (repeat) { result.wrapS = RepeatWrapping; result.wrapT = RepeatWrapping; }
  result.magFilter = LinearFilter; result.minFilter = LinearMipmapLinearFilter;
  result.generateMipmaps = true; result.needsUpdate = true;
  return result;
};

const leafDetail = (u: number, v: number) => {
  const distance = Math.abs(u - .5), side = u < .5 ? -1 : 1;
  const centre = Math.exp(-((distance / .008) ** 2));
  let secondary = 0, tertiary = 0;
  for (let vein = 0; vein < 9; vein++) {
    const root = .11 + vein * .096 + Math.sin(vein * 3.1 + side) * .012;
    const t = Math.min(1, distance / .48);
    const curve = root + t * (.13 + vein * .004) + Math.sin(t * Math.PI) * .035;
    secondary = Math.max(secondary, Math.exp(-(((v - curve) / .0048) ** 2)) * (1 - t * .30));
    const fine = curve + .04 + t * .045;
    tertiary = Math.max(tertiary, Math.exp(-(((v - fine) / .0024) ** 2)) * t * .46);
  }
  return { centre, secondary, tertiary };
};

const normalPixels = (heights: Float32Array, size: number, strength: number) => {
  const pixels = new Uint8Array(size * size * 4);
  const sample = (x: number, y: number) => heights[Math.max(0, Math.min(size - 1, y)) * size +
    Math.max(0, Math.min(size - 1, x))]!;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = -(sample(x + 1, y) - sample(x - 1, y)) * strength;
    const dy = -(sample(x, y + 1) - sample(x, y - 1)) * strength;
    const length = Math.hypot(dx, dy, 1), index = (y * size + x) * 4;
    pixels[index] = Math.round(128 + dx / length * 127);
    pixels[index + 1] = Math.round(128 + dy / length * 127);
    pixels[index + 2] = Math.round(128 + 127 / length); pixels[index + 3] = 255;
  }
  return pixels;
};

/** A single owner shares all material detail between every shrub/pot instance and palette. */
export const createRoadsideShrubTextures = () => {
  const size = 256, leaf = new Uint8Array(size * size * 4), leafHeight = new Float32Array(size * size);
  const clay = new Uint8Array(size * size * 4), clayHeight = new Float32Array(size * size);
  const clayRoughness = new Uint8Array(size * size * 4), soil = new Uint8Array(size * size * 4);
  const soilHeight = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1), v = y / (size - 1), index = (y * size + x) * 4;
    const vein = leafDetail(u, v), fine = ornamentalNoise(x * 19 + y * 377);
    const epidermis = leafMottle(u, v);
    const leafShade = .70 + vein.centre * .17 + vein.secondary * .12 + vein.tertiary * .048 + epidermis * .045;
    leaf[index] = leaf[index + 1] = leaf[index + 2] = Math.round(leafShade * 255); leaf[index + 3] = 255;
    leafHeight[y * size + x] = vein.centre * .60 + vein.secondary * .24 + vein.tertiary * .07 + fine * .018;
    const pooled = clayCoarse(u, v), mottled = clayFine(u, v);
    const throwing = Math.sin(v * Math.PI * 46 + Math.sin(u * Math.PI * 2) * .40) * .007;
    const pit = Math.max(0, fine - .88) * .75;
    const glaze = .75 + pooled * .12 + mottled * .07 + throwing + (fine - .5) * .11 - pit;
    clay[index] = Math.round(glaze * 241); clay[index + 1] = Math.round(glaze * 249);
    clay[index + 2] = Math.round(glaze * 255); clay[index + 3] = 255;
    clayHeight[y * size + x] = .5 + throwing + mottled * .05 + fine * .09 - pit * .8;
    const roughness = Math.round(168 + pooled * 29 + mottled * 18 + fine * 30);
    clayRoughness[index] = clayRoughness[index + 1] = clayRoughness[index + 2] = roughness;
    clayRoughness[index + 3] = 255;
    const granule = soilGranule(u, v), humus = soilHumus(u, v);
    const clod = Math.sqrt(granule), mineral = Math.max(0, fine - .93) * 4;
    const pore = fine < .09 ? .58 : 1;
    soil[index] = Math.round((29 + clod * 72 + humus * 11 + mineral * 73) * pore);
    soil[index + 1] = Math.round((24 + clod * 55 + humus * 9 + mineral * 64) * pore);
    soil[index + 2] = Math.round((18 + clod * 39 + humus * 7 + mineral * 51) * pore); soil[index + 3] = 255;
    soilHeight[y * size + x] = soilRelief(u, v, granule);
  }
  const maps = {
    ceramic: texture(clay, size, true, true), ceramicNormal: texture(normalPixels(clayHeight, size, 10), size, false, true),
    ceramicRoughness: texture(clayRoughness, size, false, true), leaf: texture(leaf, size, true),
    leafNormal: texture(normalPixels(leafHeight, size, 3.5), size), soil: texture(soil, size, true),
    soilNormal: texture(normalPixels(soilHeight, size, 3.5), size)
  };
  let disposed = false;
  return { maps, dispose: () => {
    if (disposed) return;
    disposed = true; Object.values(maps).forEach(map => map.dispose());
  } };
};
