import {
  DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace
} from "three";

import { ornamentalNoise } from "../../../render-common/plants/ornamental-tree-graph";

const tau = Math.PI * 2;
const plateSeeds = Array.from({ length: 18 * 4 }, (_, index) => ({
  x: .12 + ornamentalNoise(index * 43) * .76,
  y: .12 + ornamentalNoise(index * 43 + 1) * .76,
  tone: ornamentalNoise(index * 43 + 2)
}));

const maturePeachPlate = (u: number, v: number) => {
  const x = u * 18 + Math.sin(tau * v * 2) * .40 + Math.sin(tau * v * 7) * .12;
  const y = v * 4 + Math.sin(tau * u * 5) * .16;
  const cellX = Math.floor(x), cellY = Math.floor(y);
  let nearest = Infinity, second = Infinity, tone = 0, weights = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const ix = ((cellX + dx) % 18 + 18) % 18, iy = ((cellY + dy) % 4 + 4) % 4;
    const seed = plateSeeds[iy * 18 + ix]!;
    const distance = (dx + seed.x - (x - cellX)) ** 2 + (dy + seed.y - (y - cellY)) ** 2;
    const weight = Math.exp(-distance * 3);
    tone += seed.tone * weight; weights += weight;
    if (distance < nearest) { second = nearest; nearest = distance; }
    else if (distance < second) second = distance;
  }
  const edge = Math.sqrt(second) - Math.sqrt(nearest);
  // Squared edge distance has zero slope at a fissure centre; no cusp or nearest-cell height jump.
  return { fissure: Math.exp(-edge * edge * 38), tone: tone / weights };
};

const fineRelief = (u: number, v: number) =>
  Math.sin(tau * (u * 47 + Math.sin(tau * v * 13) * .12)) * .004 +
  Math.sin(tau * (u * 91 - v * 37)) * .002;

/** Continuous, shallow peach plate field; original H's discontinuous plate tone is deliberately absent. */
export const peachBarkRelief = (u: number, v: number) => {
  const plate = maturePeachPlate(u, v);
  return .55 - plate.fissure * .12 + plate.tone * .035 + fineRelief(u, v);
};

const createAgeTexture = (young: boolean) => {
  const width = young ? 128 : 512, height = young ? 256 : 512;
  const colours = new Uint8Array(width * height * 4), normals = new Uint8Array(colours.length);
  const heights = new Float32Array(width * height);
  const roughness = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height;
    const plate = young ? { fissure: 0, tone: .5 } : maturePeachPlate(u, v);
    const cellX = Math.floor(u * 8), cellY = Math.floor(v * 16);
    const seed = cellX * 17 + cellY * 67;
    const dx = u * 8 % 1 - (.2 + ornamentalNoise(seed) * .6);
    const dy = v * 16 % 1 - (.2 + ornamentalNoise(seed + 1) * .6);
    const lenticel = Math.exp(-(dx * dx * 12 + dy * dy * 380));
    const patch = Math.sin(tau * (u * 3 + v * 4)) * Math.sin(tau * (u * 5 - v * 2));
    const grain = fineRelief(u, v);
    const shade = .96 - plate.fissure * .035 + (plate.tone - .5) * .06 + grain;
    const at = (y * width + x) * 4;
    const weather = Math.min(1, Math.max(0, (plate.tone - .25 + patch * .10) * 2));
    const oldLenticel = ornamentalNoise(seed + 3) > .78 ? lenticel : 0;
    colours[at] = Math.round((young ? 135 + lenticel * 18 : 132 - weather * 7 + oldLenticel * 9) * shade);
    colours[at + 1] = Math.round((young ? 81 + lenticel * 28 : 94 + weather * 27 + oldLenticel * 9) * shade);
    colours[at + 2] = Math.round((young ? 68 + lenticel * 30 : 82 + weather * 31 + oldLenticel * 9) * shade);
    colours[at + 3] = 255;
    if (x % 2 === 0 && y % 2 === 0) {
      const roughAt = ((y / 2) * (width / 2) + x / 2) * 4;
      const value = Math.round((.84 + plate.tone * .10 + grain * 3 - plate.fissure * .035) * 255);
      roughness[roughAt] = value; roughness[roughAt + 1] = value;
      roughness[roughAt + 2] = value; roughness[roughAt + 3] = 255;
    }
    heights[y * width + x] = young ? .5 + lenticel * .035 + grain * .3 :
      .55 - plate.fissure * .12 + plate.tone * .035 + grain;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = (heights[y * width + (x + 1) % width]! -
      heights[y * width + (x + width - 1) % width]!) * 2;
    const dy = (heights[(y + 1) % height * width + x]! -
      heights[(y + height - 1) % height * width + x]!) * 2;
    const length = Math.hypot(dx, dy, 1), at = (y * width + x) * 4;
    normals[at] = Math.round((.5 - dx / length * .5) * 255);
    normals[at + 1] = Math.round((.5 - dy / length * .5) * 255);
    normals[at + 2] = Math.round((.5 + .5 / length) * 255); normals[at + 3] = 255;
  }
  const map = new DataTexture(colours, width, height, RGBAFormat);
  const normalMap = new DataTexture(normals, width, height, RGBAFormat);
  const roughnessMap = new DataTexture(roughness, width / 2, height / 2, RGBAFormat);
  map.colorSpace = SRGBColorSpace;
  for (const texture of [map, normalMap, roughnessMap]) {
    texture.wrapS = RepeatWrapping; texture.wrapT = RepeatWrapping; texture.magFilter = LinearFilter;
    texture.minFilter = LinearMipmapLinearFilter; texture.generateMipmaps = true; texture.needsUpdate = true;
  }
  return { map, normalMap, roughnessMap };
};

/** Full UV coverage per age; smaller young maps avoid wasting half of every mature bark texture. */
export const createPeachBarkTextures = () => {
  const mature = createAgeTexture(false), young = createAgeTexture(true);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const texture of [mature.map, mature.normalMap, mature.roughnessMap, young.map, young.normalMap, young.roughnessMap]) texture.dispose();
  };
  return { ...mature, youngMap: young.map, youngNormalMap: young.normalMap, youngRoughnessMap: young.roughnessMap, dispose };
};
