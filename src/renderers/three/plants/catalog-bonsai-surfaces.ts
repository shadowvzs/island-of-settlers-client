import { DataTexture, LinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace } from "three";

import { ornamentalNoise } from "../../../render-common/plants/ornamental-tree-graph";

export const createCatalogBonsaiSurface = (kind: "leaf" | "soil" | "glaze") => {
  const size = 64, pixels = new Uint8Array(size * size * 4), normals = new Uint8Array(pixels.length);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1), v = y / (size - 1), at = (y * size + x) * 4;
    const noise = ornamentalNoise(x * 131 + y * 31);
    let shade = .9 + noise * .10, relief = noise * .025;
    if (kind === "leaf") {
      const midrib = Math.exp(-Math.abs(u - .5) * 130);
      const diagonal = Math.abs(Math.sin((v - Math.abs(u - .5) * .67) * Math.PI * 13));
      const veins = Math.max(midrib, Math.max(0, 1 - diagonal * 9) * .38);
      shade = .76 + veins * .23 + noise * .035; relief = veins * .13;
    }
    if (kind === "soil") {
      const cell = Math.sin(x * 1.7 + Math.sin(y * .8)) * Math.cos(y * 1.9 + Math.cos(x));
      shade = .64 + noise * .32 + Math.max(0, cell) * .32; relief = Math.max(0, cell) * .26;
    }
    if (kind === "glaze") {
      const stroke = Math.sin(y * .4 + Math.sin(x * .15)) * .025;
      shade = .90 + stroke + noise * .06; relief = noise * .018;
    }
    const pigments = kind === "soil" ? [177, 148, 107] : [255, 255, 255];
    for (let channel = 0; channel < 3; channel++) pixels[at + channel] = pigments[channel]! * shade;
    pixels[at + 3] = 255; height[y * size + x] = relief;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = height[y * size + (x + 1) % size]! - height[y * size + (x + size - 1) % size]!;
    const dy = height[((y + 1) % size) * size + x]! - height[((y + size - 1) % size) * size + x]!;
    normals.set([128 - dx * 170, 128 - dy * 170, 250, 255], (y * size + x) * 4);
  }
  const map = new DataTexture(pixels, size, size, RGBAFormat);
  const normalMap = new DataTexture(normals, size, size, RGBAFormat);
  map.colorSpace = SRGBColorSpace;
  for (const texture of [map, normalMap]) {
    texture.magFilter = LinearFilter; texture.minFilter = LinearFilter;
    texture.wrapS = RepeatWrapping; texture.wrapT = RepeatWrapping; texture.needsUpdate = true;
  }
  return { map, normalMap, dispose: () => { map.dispose(); normalMap.dispose(); } };
};
