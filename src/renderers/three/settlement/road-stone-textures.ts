import { createPeriodicNoise } from "../../../render-common/materials/periodic-noise";
import { fract, sinHash2 } from "../../../shared/world/noise";
import { createPeriodicTextureNoise } from "./road-dirt-texture";

type Rgb = readonly [number, number, number];
type PavingTier = "stone" | "marble" | "limestone" | "basalt" | "granite";

interface StoneSample {
  brightness: number;
  height: number;
  tint?: Rgb;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const toByte = (value: number) => Math.round(clamp01(value) * 255);
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const rowLayout = (u: number, v: number, rows: number, columns: number) => {
  const row = Math.floor(v * rows);
  const rowFraction = v * rows - row;
  const columnRaw = u * columns + (row % 2) * 0.5;
  const column = fract(columnRaw);
  const edge = Math.min(column, 1 - column, rowFraction, 1 - rowFraction);
  return { columnIndex: Math.floor(columnRaw), edge, row };
};

/** Weathered polygonal paving: varied fitted stones, rounded rims and narrow earth-filled joints. */
const stoneSample = (u: number, v: number, x: number, y: number): StoneSample => {
  const warpU = stoneNoise.gradient(u, v, 3) * .013;
  const warpV = stoneNoise.gradient(u + .25, v + .5, 3) * .013;
  const cell = stoneNoise.worley(u + warpU, v + warpV, 4);
  const seam = cell.second - cell.nearest;
  const grain = (sinHash2(x, y) - .5) * .07;
  const mottling = stoneNoise.gradient(u, v, 13) * .04;
  const bevel = smoothstep(.032, .22, seam);
  const mortar = seam < .032;
  const tone = cell.nearestId - .5;
  return {
    brightness: mortar ? .43 + grain * .25 : .79 + bevel * .17 + tone * .15 + grain + mottling,
    height: mortar ? .06 : .24 + bevel * .56 + grain * .3 + mottling,
    tint: mortar ? [1.06, .98, .85] : [1.035 + tone * .04, 1.01, .97 - tone * .025]
  };
};

/** Large polished slabs with irregular light and dark veins. */
const marbleSample = (u: number, v: number, x: number, y: number): StoneSample => {
  const { columnIndex, edge, row } = rowLayout(u, v, 2, 2);
  const grain = sinHash2(x * 1.4, y * 1.7) - 0.5;
  const warp = (marbleNoise(fract(u * 2.2), fract(v * 2.2)) - 0.5) * 0.24;
  const vein = (1 - Math.abs(Math.sin((u * 2.4 + v * 1.5 + warp) * Math.PI))) ** 30;
  const secondVein = (1 - Math.abs(Math.sin((u * 1.1 - v * 2.3 + warp * 0.7) * Math.PI))) ** 52;
  const mortar = edge < 0.012;
  const bevel = smoothstep(0.012, 0.06, edge);
  const tone = sinHash2(row, columnIndex) - 0.5;
  const brightness = mortar
    ? 0.55
    : 0.98 + tone * 0.035 + grain * 0.035 - vein * 0.16 + secondVein * 0.07;
  const height = mortar ? 0.05 : 0.3 + bevel * 0.56 + grain * 0.04;
  return { brightness, height };
};

/** Warm ashlar blocks with bedding planes and small fossil pits. */
const limestoneSample = (u: number, v: number, x: number, y: number): StoneSample => {
  const { columnIndex, edge, row } = rowLayout(u, v, 6, 4);
  const grain = sinHash2(x * 1.2, y * 1.5) - 0.5;
  const mottling = (limestoneNoise(fract(u * 5), fract(v * 3)) - 0.5) * 0.09;
  const bedding =
    Math.max(0, Math.sin(v * Math.PI * 18 + limestoneNoise(fract(u * 2), fract(v * 2)) * 2.5)) ** 24;
  const fossilCell = 32;
  const fossilX = Math.floor(u * fossilCell), fossilY = Math.floor(v * fossilCell);
  const fossil = sinHash2(fossilX, fossilY);
  const fossilDistance = Math.hypot(fract(u * fossilCell) - 0.5, fract(v * fossilCell) - 0.5);
  const fossilPit = fossil > 0.94 && fossilDistance < 0.2 ? 1 : 0;
  const mortar = edge < 0.02;
  const bevel = smoothstep(0.02, 0.075, edge);
  const tone = sinHash2(row, columnIndex) - 0.5;
  const brightness = mortar
    ? 0.5
    : 0.95 + mottling + grain * 0.05 + tone * 0.03 - bedding * 0.07 + fossilPit * 0.12;
  const height = mortar ? 0.06 : 0.3 + bevel * 0.5 + mottling + fossilPit * 0.12;
  return { brightness, height };
};

/** Dark polygonal basalt columns with tight seams, fine striations and vesicles. */
const basaltSample = (u: number, v: number, x: number, y: number): StoneSample => {
  const cell = basaltNoise.worley(u, v, 5);
  const seam = cell.second - cell.nearest;
  const mortar = seam < 0.075;
  const bevel = smoothstep(0.075, 0.19, seam);
  const tone = cell.nearestId - 0.5;
  const striation = Math.sin((u * 15 + v * 2.4 + cell.offsetX * 2.8) * Math.PI * 2);
  const vesicle = sinHash2(x * 2.1 + 5, y * 2.7 + 11);
  const pit = vesicle > 0.965 ? 1 : 0;
  const brightness = mortar
    ? 0.44
    : 0.9 + tone * 0.1 + striation * 0.025 - pit * 0.2;
  const height = mortar ? 0.055 : 0.32 + bevel * 0.5 - pit * 0.16;
  return { brightness, height };
};

/** Broad granite flags with coarse mineral speckle and occasional warm feldspar. */
const graniteSample = (u: number, v: number, x: number, y: number): StoneSample => {
  const { columnIndex, edge, row } = rowLayout(u, v, 3, 3);
  const grain = sinHash2(x * 1.6 + 3, y * 2.1 + 7) - 0.5;
  const mottling = (graniteNoise(fract(u * 7), fract(v * 4)) - 0.5) * 0.08;
  const speck = sinHash2(u * 96 + 11, v * 96 + 5);
  const warm = sinHash2(u * 44 + 19, v * 44 + 23);
  const mortar = edge < 0.014;
  const bevel = smoothstep(0.014, 0.055, edge);
  const darkFleck = speck < 0.06 ? 1 : 0;
  const lightFleck = speck > 0.94 ? 1 : 0;
  const brightness = mortar
    ? 0.5
    : 0.94 + mottling + grain * 0.07 + lightFleck * 0.2 - darkFleck * 0.24;
  const tone = sinHash2(row, columnIndex) - 0.5;
  const height = mortar ? 0.05 : 0.3 + bevel * 0.53 + grain * 0.05;
  return {
    brightness: brightness + tone * 0.03,
    height,
    tint: warm > 0.965 ? [1.08, 0.99, 0.94] : undefined
  };
};

const marbleNoise = createPeriodicTextureNoise(4);
const limestoneNoise = createPeriodicTextureNoise(11);
const graniteNoise = createPeriodicTextureNoise(17);
const basaltNoise = createPeriodicNoise(0x9a51);
const stoneNoise = createPeriodicNoise(0x2837);

const paintTexture = (
  pixels: Uint8Array,
  relief: Uint8Array,
  size: number,
  color: Rgb,
  sample: (u: number, v: number, x: number, y: number) => StoneSample
) => {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const stone = sample(u, v, x, y);
      const offset = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const tint = stone.tint?.[channel] ?? 1;
        pixels[offset + channel] = toByte((color[channel]! / 255) * stone.brightness * tint);
        relief[offset + channel] = toByte(stone.height);
      }
      pixels[offset + 3] = 255;
      relief[offset + 3] = 255;
    }
  }
};

/** Bakes a unique paved surface per tier into the same RGBA/relief texture layout. */
export const paintStoneRoadTexture = (
  pixels: Uint8Array,
  relief: Uint8Array,
  size: number,
  tier: PavingTier,
  color: Rgb
) => {
  if (tier === "marble") return paintTexture(pixels, relief, size, color, marbleSample);
  if (tier === "limestone") return paintTexture(pixels, relief, size, color, limestoneSample);
  if (tier === "basalt") return paintTexture(pixels, relief, size, color, basaltSample);
  if (tier === "granite") return paintTexture(pixels, relief, size, color, graniteSample);
  return paintTexture(pixels, relief, size, color, stoneSample);
};
