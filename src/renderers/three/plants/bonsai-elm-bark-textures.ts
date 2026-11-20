import {
  DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace,
  UnsignedByteType
} from "three";

import { ornamentalNoise } from "../../../render-common/plants/ornamental-tree-graph";

const wrap = (value: number, count: number) => (value % count + count) % count;

const elmPatchCells = Array.from({ length: 240 }, (_, index) => {
  const seed = index % 12 * 71 + Math.floor(index / 12) * 131;
  return { offsetX: .5 + (ornamentalNoise(seed) - .5) * .65,
    offsetY: .5 + (ornamentalNoise(seed + 1) - .5) * .65,
    pigment: Math.floor(ornamentalNoise(seed + 2) * 5), height: ornamentalNoise(seed + 3) * .10 };
});

const elmPatchAt = (u: number, v: number) => {
  const angleU = u / 12 * Math.PI * 2, angleV = v / 20 * Math.PI * 2;
  const warpedU = u + .42 * Math.sin(angleV * 5 + .4 * Math.sin(angleU * 2))
    + .16 * Math.sin(angleV * 9 + angleU * 3);
  const warpedV = v + .43 * Math.sin(angleU * 4 + .3 * Math.sin(angleV * 3))
    + .14 * Math.sin(angleU * 7 + angleV * 5);
  let closest = 100, second = 100, patch = elmPatchCells[0]!;
  for (let row = -1; row <= 1; row++) for (let column = -1; column <= 1; column++) {
    const cellX = Math.floor(warpedU) + column, cellY = Math.floor(warpedV) + row;
    const cell = elmPatchCells[wrap(cellY, 20) * 12 + wrap(cellX, 12)]!;
    const distance = (warpedU - cellX - cell.offsetX) ** 2 + (warpedV - cellY - cell.offsetY) ** 2;
    if (distance < closest) { second = closest; closest = distance; patch = cell; }
    else if (distance < second) second = distance;
  }
  return { closest, second, patch };
};

/** Fine exfoliating gray/olive/tan islands, not generic brown longitudinal wood grain. */
export const createBonsaiElmBarkTextures = (lightness = 1) => {
  const width = 128, height = 256, relief = new Float32Array(width * height);
  const colour = new Uint8Array(width * height * 4), normals = new Uint8Array(colour.length);
  const palette = [[159, 158, 133], [125, 132, 109], [171, 149, 119], [144, 149, 128], [120, 122, 107]];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const { closest, patch, second } = elmPatchAt(x / width * 12, y / height * 20);
    const boundary = Math.sqrt(second) - Math.sqrt(closest);
    const seam = Math.exp(-boundary * 42), grain = ornamentalNoise(x * 17 + y * 71);
    const shade = .95 + grain * .08 - seam * .16;
    const pigment = palette[patch.pigment]!;
    const at = (y * width + x) * 4;
    for (let channel = 0; channel < 3; channel++)
      colour[at + channel] = Math.min(255, Math.round(pigment[channel]! * shade * lightness));
    colour[at + 3] = 255;
    relief[y * width + x] = patch.height - seam * .13 + grain * .008;
  }
  const sample = (x: number, y: number) => relief[wrap(y, height) * width + wrap(x, width)]!;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = (sample(x + 1, y) - sample(x - 1, y)) * 1.5;
    const dy = (sample(x, y + 1) - sample(x, y - 1)) * 1.5;
    const length = Math.hypot(dx, dy, 1), at = (y * width + x) * 4;
    normals[at] = Math.round((.5 - dx / length * .5) * 255);
    normals[at + 1] = Math.round((.5 - dy / length * .5) * 255);
    normals[at + 2] = Math.round((.5 + .5 / length) * 255); normals[at + 3] = 255;
  }
  const map = new DataTexture(colour, width, height, RGBAFormat, UnsignedByteType);
  map.colorSpace = SRGBColorSpace;
  const normalMap = new DataTexture(normals, width, height, RGBAFormat, UnsignedByteType);
  for (const texture of [map, normalMap]) {
    texture.wrapS = RepeatWrapping; texture.wrapT = RepeatWrapping;
    texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.needsUpdate = true;
  }
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; map.dispose(); normalMap.dispose();
    map.image.data = null; normalMap.image.data = null;
  };
  return { map, normalMap, species: "bonsai-elm" as const, dispose };
};
