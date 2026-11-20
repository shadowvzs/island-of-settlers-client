import {
  DataTexture, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial,
  RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType
} from "three";

import { ornamentalNoise } from "../../../render-common/plants/ornamental-tree-graph";

const seam = (value: number) => Math.min(value - Math.floor(value), Math.ceil(value) - value);

const plateNoise = (x: number, y: number) => {
  const ix = Math.floor(x), iy = Math.floor(y);
  const sx = (x - ix) ** 2 * (3 - 2 * (x - ix));
  const sy = (y - iy) ** 2 * (3 - 2 * (y - iy));
  const a = ornamentalNoise(ix * 173 + iy * 719);
  const b = ornamentalNoise((ix + 1) * 173 + iy * 719);
  const c = ornamentalNoise(ix * 173 + (iy + 1) * 719);
  const d = ornamentalNoise((ix + 1) * 173 + (iy + 1) * 719);
  return a * (1 - sx) * (1 - sy) + b * sx * (1 - sy) + c * (1 - sx) * sy + d * sx * sy;
};

/** Original interrupted cork plates and shallow fissures; no source photograph pixels. */
export const createMapleBarkMaterial = () => {
  const width = 256, height = 512, pixels = new Uint8Array(width * height * 4);
  const turn = Math.PI * 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height;
    const warped = u * 9 + Math.sin(v * turn * 2 + Math.sin(u * turn * 3) * .3) * .18 +
      Math.sin(v * turn * 7 + u * turn * 4) * .065;
    const column = (Math.floor(warped) % 9 + 9) % 9;
    const cross = v * (4 + column % 3) + ornamentalNoise(column * 13.7) * .8 + Math.sin(u * turn * 3) * .21;
    const verticalCrack = Math.exp(-seam(warped) * 65) *
      (.65 + Math.sin(v * turn * (3 + column % 3) + column) ** 2 * .35);
    const interrupted = .35 + .65 * (.5 + Math.sin(v * turn * 11 + u * turn * 5) * .5);
    const crossCrack = Math.exp(-seam(cross) * 55) * interrupted *
      (.5 + ornamentalNoise(column * 71) * .5);
    const cell = Math.sin((warped - Math.floor(warped)) * Math.PI);
    const ridge = Math.max(0, cell) ** .75 * .15;
    const grain = Math.sin(u * turn * 23 + Math.sin(v * turn * 7)) * .018 +
      Math.cos(v * turn * 31 + Math.sin(u * turn * 9)) * .012;
    const pores = (ornamentalNoise(x * 17 + y * 89) - .5) * .025 +
      (plateNoise(x / 11, y / 17) - .5) * .12;
    const shade = Math.max(.30, Math.min(.96,
      .72 + ridge + grain + pores - verticalCrack * .34 - crossCrack * .21));
    const at = (y * width + x) * 4;
    pixels[at] = Math.round(shade * 242);
    pixels[at + 1] = Math.round(shade * 240);
    pixels[at + 2] = Math.round(shade * 229);
    pixels[at + 3] = 255;
  }
  const map = new DataTexture(pixels, width, height, RGBAFormat, UnsignedByteType);
  map.colorSpace = SRGBColorSpace; map.wrapS = RepeatWrapping; map.wrapT = RepeatWrapping;
  map.repeat.y = .25;
  map.magFilter = LinearFilter; map.minFilter = LinearMipmapLinearFilter;
  map.generateMipmaps = true; map.needsUpdate = true;
  const material = new MeshStandardMaterial({ color: "#b28a62", roughness: .96,
    vertexColors: true, map, bumpMap: map, bumpScale: .016 });
  material.name = "ornamental_maple_bark";
  let disposed = false;
  return { material, map, dispose: () => {
    if (disposed) return;
    disposed = true; material.dispose(); map.dispose(); map.image.data = null;
  } };
};
