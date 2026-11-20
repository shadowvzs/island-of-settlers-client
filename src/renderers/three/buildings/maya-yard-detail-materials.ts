import {
  DataTexture, LinearFilter, LinearMipmapLinearFilter, type MeshStandardMaterial, RepeatWrapping, RGBAFormat,
  SRGBColorSpace, Vector2
} from "three";

import { cachedPixelSet } from "./building-pixel-cache";

/** A painted map set: albedo, tangent-space normal and roughness. */
interface DetailMaps {
  albedo: Uint8Array;
  normal: Uint8Array;
  roughness: Uint8Array;
}

const smooth = (value: number) => value * value * (3 - 2 * value);
const random = (x: number, y: number, seed: number) => {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 19.17) * 43758.5453;
  return value - Math.floor(value);
};
const wrap = (value: number, period: number) => ((value % period) + period) % period;

/** Periodic value noise: every lattice edge wraps, so the column and figure maps tile seamlessly. */
const noise = (u: number, v: number, period: number, seed: number) => {
  const x = u * period, y = v * period, ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const at = (dx: number, dy: number) =>
    random(wrap(ix + dx, period), wrap(iy + dy, period), seed);
  const lower = at(0, 0) * (1 - fx) + at(1, 0) * fx;
  const upper = at(0, 1) * (1 - fx) + at(1, 1) * fx;
  return lower * (1 - fy) + upper * fy;
};

const paintMaps = (size: number, heightAt: (u: number, v: number) => number,
  albedoAt: (u: number, v: number, height: number) => [number, number, number],
  roughnessAt: (u: number, v: number, height: number) => number): DetailMaps => {
  const albedo = new Uint8Array(size * size * 4), normal = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4), heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size, v = (y + .5) / size, height = heightAt(u, v);
    heights[y * size + x] = height;
    const [red, green, blue] = albedoAt(u, v, height), index = (y * size + x) * 4;
    const roughnessValue = roughnessAt(u, v, height);
    albedo.set([red, green, blue, 255], index);
    roughness.set([roughnessValue, roughnessValue, roughnessValue, 255], index);
  }
  const at = (x: number, y: number) => heights[wrap(y, size) * size + wrap(x, size)]!;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x - 1, y) - at(x + 1, y)) * .9;
    const dy = (at(x, y - 1) - at(x, y + 1)) * .9;
    const length = Math.hypot(dx, dy, 1), index = (y * size + x) * 4;
    normal.set([(dx / length * .5 + .5) * 255, (dy / length * .5 + .5) * 255,
      (.5 / length + .5) * 255, 255], index);
  }
  return { albedo, normal, roughness };
};

const texture = (data: Uint8Array, size: number, colour: boolean) => {
  const map = new DataTexture(data, size, size, RGBAFormat);
  map.wrapS = map.wrapT = RepeatWrapping;
  map.magFilter = LinearFilter;
  map.minFilter = LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  if (colour) map.colorSpace = SRGBColorSpace;
  map.needsUpdate = true;
  return map;
};

/** Hammered and burnished gold with dark recesses, so the fluted shaft reads as metal, not flat paint. */
const gildedColumnMaps = (detailed: boolean) => {
  const size = detailed ? 256 : 64;
  return cachedPixelSet(`maya-gilded-column:${size}`, () => {
    const maps = paintMaps(size,
      (u, v) => .5 + (noise(u, v, 8, 3) - .5) * .05 + (noise(u, v, 29, 7) - .5) * .035
        + Math.sin(u * Math.PI * 2 * 36 + noise(u, v, 9, 11) * 2.4) * .03
        + Math.sin(v * Math.PI * 2 * 3 + noise(u, v, 6, 13) * 1.8) * .012,
      (u, v, height) => {
        const patina = Math.max(0, noise(u, v, 7, 17) - .62) * 1.8
          + Math.max(0, .22 - v) * .55 + Math.max(0, v - .84) * .4;
        const shine = (height - .5) * 120 + (noise(u, v, 23, 19) - .5) * 18;
        return [188 + shine - patina * 46, 145 + shine * .78 - patina * 38,
          62 + shine * .32 - patina * 22];
      },
      (u, v, height) => 118 + (height - .5) * 90 + noise(u, v, 17, 23) * 34);
    return [maps.albedo, maps.normal, maps.roughness];
  });
};

/** Fine clay grain, tool scraping and chipped pigment on the painted yard figurine. */
const yardFigurineMaps = (detailed: boolean) => {
  const size = detailed ? 256 : 64;
  return cachedPixelSet(`maya-yard-figurine:${size}`, () => {
    const maps = paintMaps(size,
      (u, v) => .5 + (noise(u, v, 5, 31) - .5) * .3 + (noise(u, v, 17, 37) - .5) * .18
        + (noise(u, v, 47, 41) - .5) * .08
        + Math.sin(v * Math.PI * 2 * 7 + noise(u, v, 11, 43) * 2) * .025,
      (u, v, height) => {
        const chip = noise(u, v, 48, 47);
        const worn = noise(u, v, 7, 53);
        const shade = 210 + (height - .5) * 120 + (worn - .5) * 42 - (chip < .06 ? 72 : 0);
        return [shade * 1.015, shade, shade * .95];
      },
      (u, v, height) => 200 + (1 - height) * 55 + noise(u, v, 19, 59) * 28);
    return [maps.albedo, maps.normal, maps.roughness];
  });
};

const detailMaterial = (source: MeshStandardMaterial, detailed: boolean,
  maps: readonly Uint8Array[], size: number, name: string) => {
  const material = source.clone();
  material.name = name;
  material.color.setRGB(1, 1, 1);
  material.map = texture(maps[0]!, size, true);
  material.normalMap = detailed ? texture(maps[1]!, size, false) : null;
  material.roughnessMap = detailed ? texture(maps[2]!, size, false) : null;
  material.normalScale = new Vector2(detailed ? .7 : 0, detailed ? .7 : 0);
  material.metalness = 0;
  material.vertexColors = true;
  return material;
};

/** Aged gilding on the retained fluted Maya civic columns: a readable metal surface on both renderers. */
export const createMayaGildedColumnMaterial = (source: MeshStandardMaterial, detailed: boolean) => {
  const maps = gildedColumnMaps(detailed);
  const material = detailMaterial(source, detailed, maps, detailed ? 256 : 64, "maya_gilded_column");
  material.roughness = .5;
  return material;
};

/** Painted terracotta detail for the Maya yard figurine: grain, chips, worn pigment and tool marks. */
export const createMayaYardFigurineMaterial = (source: MeshStandardMaterial, detailed: boolean) => {
  const maps = yardFigurineMaps(detailed);
  const material = detailMaterial(source, detailed, maps, detailed ? 256 : 64, "maya_yard_figurine");
  if (detailed) material.normalScale.set(1.35, 1.35);
  material.roughness = .92;
  return material;
};
