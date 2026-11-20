import { DataTexture, DoubleSide, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial,
  NoColorSpace, RepeatWrapping, RGBAFormat, SRGBColorSpace, type Texture } from "three";

import { createWisteriaBotanicalAtlas } from "./wisteria-botanical-atlas";

type Painter = (u: number, v: number) => readonly [number, number, number];
const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const barkNoise = (x: number, y: number) => {
  const hash = (a: number, b: number) => { const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return value - Math.floor(value); };
  const ix = Math.floor(x), iy = Math.floor(y), sx = x - ix, sy = y - iy;
  const u = sx * sx * (3 - 2 * sx), v = sy * sy * (3 - 2 * sy);
  return (hash(ix, iy) * (1 - u) + hash(ix + 1, iy) * u) * (1 - v) +
    (hash(ix, iy + 1) * (1 - u) + hash(ix + 1, iy + 1) * u) * v;
};

/** Original vein/fold/furrow patterns; photographs remain references, never copied runtime maps. */
export const createWisteriaBotanicalMaterials = (options: { neutralAtlas?: boolean; atlasTexture?: Texture } = {}) => {
  const atlas = options.neutralAtlas ? createWisteriaBotanicalAtlas(options.atlasTexture ? (_url, ready) => { ready(options.atlasTexture!); return options.atlasTexture!; } : undefined) : undefined;
  const maps: DataTexture[] = [];
  const texture = (paint: Painter, width = 256, height = 256) => {
    const pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const colour = paint(x / (width - 1), y / (height - 1)), offset = (y * width + x) * 4;
      pixels.set([clamp(colour[0]), clamp(colour[1]), clamp(colour[2]), 255], offset);
    }
    const map = new DataTexture(pixels, width, height, RGBAFormat); map.colorSpace = SRGBColorSpace;
    map.wrapS = map.wrapT = RepeatWrapping; map.magFilter = LinearFilter;
    map.minFilter = LinearMipmapLinearFilter; map.generateMipmaps = true; map.needsUpdate = true;
    maps.push(map); return map;
  };
  const petalMap = atlas?.texture ?? texture((u, v) => {
    const fold = Math.exp(-Math.abs(u - .5) * 18) * (1 - v) * 15;
    const fan = Math.abs(Math.sin((u - .5) / (.20 + v * .8) * 34));
    const vein = (1 - fan) ** 12 * 9 * v;
    const shade = 236 + v * 15 - fold - vein;
    return [shade, shade, shade];
  });
  const leafMap = atlas?.texture ?? texture((u, v) => {
    const lateral = Math.abs(u - .5), midrib = Math.exp(-lateral * 180);
    let veins = 0;
    for (let branch = 0; branch < 7; branch++) {
      const base = .10 + branch * .115 + (u < .5 ? .035 : 0);
      const distance = Math.abs(v - base - .36 * lateral ** .8);
      veins = Math.max(veins, Math.exp(-distance * 180) * Math.min(1, lateral * 18));
    }
    const tissue = Math.cos(lateral * 27 + v * 8) * 3, shade = 218 + tissue + midrib * 25 + veins * 14;
    return [shade, shade, shade];
  });
  const barkMap = texture((u, v) => {
    const knot = Math.hypot((u - .62) * 2.6, (v - .46) * 1.8);
    const irregular = barkNoise(u * 13, v * 9), patches = barkNoise(u * 6, v * 17);
    const flow = u * 17 + Math.sin(v * 13 + irregular * 4) * .9 + Math.exp(-knot * 7) * 3;
    const furrow = Math.abs(Math.sin(flow)), fissure = (1 - furrow) ** 6;
    const knots = Math.exp(-Math.abs(knot - .20) * 45) * 16;
    const shade = 167 + patches * 40 + furrow * 20 - fissure * (12 + irregular * 31) - knots;
    return [shade * 1.015, shade, shade * .97];
  }, 256, 512);
  const normalMap = (source: DataTexture, strength: number) => {
    const { data, height, width } = source.image;
    const at = (x: number, y: number) => data![((y + height) % height * width + (x + width) % width) * 4]! / 255;
    const normal = texture((u, v) => {
      const x = Math.round(u * (width - 1)), y = Math.round(v * (height - 1));
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength, length = Math.hypot(dx, dy, 1);
      return [(dx / length * .5 + .5) * 255, (dy / length * .5 + .5) * 255, (1 / length * .5 + .5) * 255];
    }, width, height);
    normal.colorSpace = NoColorSpace; return normal;
  };
  const petal = new MeshStandardMaterial({ map: petalMap, normalMap: atlas ? null : normalMap(petalMap as DataTexture, 2),
    roughness: .70, vertexColors: true, side: DoubleSide });
  const leaf = new MeshStandardMaterial({ map: leafMap, normalMap: atlas ? null : normalMap(leafMap as DataTexture, 3),
    roughness: .85, vertexColors: true, side: DoubleSide });
  const bark = new MeshStandardMaterial({ map: barkMap, normalMap: normalMap(barkMap, 4),
    roughness: .94, vertexColors: true, color: "#817568" });
  const calyx = new MeshStandardMaterial({ color: "#666b3a", roughness: .88 });
  const throat = new MeshStandardMaterial({ color: "#f3edc0", roughness: .80, side: DoubleSide });
  if (atlas) for (const material of [petal, leaf]) {
    material.map = atlas.texture;
    material.normalMap = null;
    material.bumpMap = atlas.texture;
    material.bumpScale = material === leaf ? .004 : .002;
    material.alphaTest = .22;
  }
  let disposed = false;
  return { petal, leaf, bark, calyx, throat, atlasReady: () => !atlas || atlas.state().ready,
    atlasFailed: () => atlas?.state().failed ?? false, dispose: () => {
    if (disposed) return; disposed = true;
    for (const material of [petal, leaf, bark, calyx, throat]) material.dispose();
    atlas?.dispose();
    for (const map of maps) { map.dispose(); map.image.data = null; }
  } };
};
