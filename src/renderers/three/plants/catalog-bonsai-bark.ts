import { DataTexture, LinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace } from "three";

import { ornamentalNoise } from "../../../render-common/plants/ornamental-tree-graph";

/** Original small repeatable fissure maps shared by all variants and both distance tiers. */
export const createCatalogBonsaiBark = (juniper: boolean) => {
  const width = 64, height = 128, colour = new Uint8Array(width * height * 4);
  const normal = new Uint8Array(colour.length);
  const relief = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const bend = Math.sin(y * .12) * 1.4 + Math.sin(y * .31) * .5;
    const grain = Math.sin((x + bend) * 1.45);
    const seam = Math.max(0, grain) ** 10;
    const noise = ornamentalNoise(x * 31 + y * 17);
    const shade = .92 + noise * .12 - seam * .28;
    const at = (y * width + x) * 4;
    const pigment = juniper ? [172, 118, 72] : [167, 141, 104];
    for (let channel = 0; channel < 3; channel++) colour[at + channel] = pigment[channel]! * shade;
    colour[at + 3] = 255; relief[y * width + x] = seam * .15 + noise * .025;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    const dx = relief[y * width + (x + 1) % width]! - relief[y * width + (x + width - 1) % width]!;
    const dy = relief[((y + 1) % height) * width + x]! - relief[((y + height - 1) % height) * width + x]!;
    normal.set([128 - dx * 180, 128 - dy * 180, 250, 255], at);
  }
  const map = new DataTexture(colour, width, height, RGBAFormat);
  const normalMap = new DataTexture(normal, width, height, RGBAFormat);
  map.colorSpace = SRGBColorSpace;
  for (const texture of [map, normalMap]) {
    texture.wrapS = RepeatWrapping; texture.wrapT = RepeatWrapping;
    texture.magFilter = LinearFilter; texture.minFilter = LinearFilter; texture.needsUpdate = true;
  }
  return { map, normalMap, dispose: () => { map.dispose(); normalMap.dispose(); } };
};
