import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AtlasMip } from "../../../src/render-common/baker/atlas-mips";
import { rgb, srgbToLinear, toByte } from "../../../src/render-common/color";
import { FOLIAGE_ATLAS_GRID } from "../../../src/render-common/plants/foliage-atlas-layout";
import { encodePng } from "../../dev/png";
import type { BakedFoliageAtlas } from "./atlas-bake";

export type Linear = [number, number, number];

export const linearOf = (hex: number): Linear => srgbToLinear(...rgb(hex));
const ROSE_LEAF = linearOf(0x4c7a30), IVY = linearOf(0x3a6626), ADULT_IVY = linearOf(0x4e7a32);
const CALYX = linearOf(0x557f2e), NONE: Linear = [1, 1, 1];

/** Vertex tints a climber recipe would assign per tile (D05a/D05b palettes), for the review only. */
const tileTints = (petal: Linear): Linear[] => [ROSE_LEAF, ROSE_LEAF, ROSE_LEAF, petal, petal, petal, CALYX, petal,
  IVY, IVY, ADULT_IVY, IVY, IVY, ROSE_LEAF, petal, NONE];

const RED = linearOf(0xc01a30), WHITE = linearOf(0xf4efe2);
const BACKGROUND = linearOf(0x8fa3ae);
const LIGHT = (() => {
  const light = [-0.45, 0.55, 0.7], length = Math.hypot(...light);
  return light.map(value => value / length) as Linear;
})();

const decodeSrgb = (byte: number) => (byte / 255) ** 2.2;
const encode = (value: number) => toByte(Math.pow(Math.max(0, value), 1 / 2.2));

interface LitOptions { backlit: boolean; tints: Linear[] }

const shadeTexel = (albedo: Uint8Array, normal: Uint8Array, material: Uint8Array, offset: number, tint: Linear,
  backlit: boolean): Linear => {
  const nx = normal[offset]! / 127.5 - 1, ny = normal[offset + 1]! / 127.5 - 1, nz = normal[offset + 2]! / 127.5 - 1;
  const translucency = material[offset]! / 255, roughness = material[offset + 1]! / 255;
  const mask = material[offset + 2]! / 255;
  const diffuse = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
  const hz = LIGHT[2] + 1, hl = Math.hypot(LIGHT[0], LIGHT[1], hz);
  const half = Math.max(0, (nx * LIGHT[0] + ny * LIGHT[1] + nz * hz) / hl);
  const gloss = (1 - roughness) ** 2, specular = Math.pow(half, 6 + 74 * gloss) * gloss * 0.35;
  const light = backlit ? 0.3 + translucency * 1.1 : 0.38 + 0.85 * diffuse;
  return [0, 1, 2].map(channel => {
    const colour = decodeSrgb(albedo[offset + channel]!) * (1 + (tint[channel]! - 1) * mask);
    return colour * light + (backlit ? 0 : specular);
  }) as Linear;
};

/** Lit card colours over a sky-grey background; rows flipped so +v is up in the image. */
const renderLit = (albedo: AtlasMip, normal: AtlasMip, material: AtlasMip, options: LitOptions) => {
  const { height, width } = albedo, out = new Uint8Array(width * height * 4), tile = width / FOLIAGE_ATLAS_GRID;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4, target = ((height - 1 - y) * width + x) * 4;
    const index = Math.floor(y / tile) * FOLIAGE_ATLAS_GRID + Math.floor(x / tile);
    const coverage = Math.min(1, Math.max(0, (albedo.data[offset + 3]! / 255 - 0.4) / 0.2));
    const lit = shadeTexel(albedo.data, normal.data, material.data, offset, options.tints[index]!, options.backlit);
    for (let channel = 0; channel < 3; channel += 1) {
      out[target + channel] = encode(BACKGROUND[channel]! + (lit[channel]! - BACKGROUND[channel]!) * coverage);
    }
    out[target + 3] = 255;
  }
  return out;
};

const flipped = (level: AtlasMip, alphaAsGrey = false) => {
  const { data, height, width } = level, out = new Uint8Array(data.length);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const from = (y * width + x) * 4, to = ((height - 1 - y) * width + x) * 4;
    if (alphaAsGrey) out.fill(data[from + 3]!, to, to + 3);
    else out.set(data.subarray(from, from + 3), to);
    out[to + 3] = 255;
  }
  return out;
};

/** Nearest-neighbour enlargement so a small mip level shows its real texel structure. */
const enlarged = (pixels: Uint8Array, width: number, height: number, factor: number) => {
  const out = new Uint8Array(width * factor * height * factor * 4);
  for (let y = 0; y < height * factor; y += 1) for (let x = 0; x < width * factor; x += 1) {
    const from = (Math.floor(y / factor) * width + Math.floor(x / factor)) * 4;
    out.set(pixels.subarray(from, from + 4), (y * width * factor + x) * 4);
  }
  return out;
};

/** Approximate texel scale per review view (see the D04a receipt for the derivation). */
const VIEW_LEVELS = [["possessed-close", 0], ["possessed-normal", 2], ["possessed-spyglass", 3],
  ["isometric-normal", 5]] as const;

/**
 * Review PNGs of a baked atlas: raw maps, each named tint variant lit, the first one back-lit and
 * at the texel scale of every review view. `variants` holds one vertex tint per tile.
 */
export const writeFoliagePreviews = (atlas: BakedFoliageAtlas, directory: string,
  variants: Readonly<Record<string, Linear[]>>) => {
  mkdirSync(directory, { recursive: true });
  const write = (name: string, level: AtlasMip, pixels: Uint8Array) =>
    writeFileSync(join(directory, `${name}.png`), encodePng(level.width, level.height, pixels));
  const base = atlas.albedo[0]!;
  write("atlas-albedo-rgb", base, flipped(base));
  write("atlas-alpha", base, flipped(base, true));
  write("atlas-normal", base, flipped(atlas.normal[0]!));
  write("atlas-orm", base, flipped(atlas.material[0]!));
  const litBase = (options: LitOptions) => renderLit(base, atlas.normal[0]!, atlas.material[0]!, options);
  const [first, firstTints] = Object.entries(variants)[0]!;
  for (const [name, tints] of Object.entries(variants)) write(`lit-${name}`, base, litBase({ backlit: false, tints }));
  write(`backlit-${first}`, base, litBase({ backlit: true, tints: firstTints }));
  for (const [view, levelIndex] of VIEW_LEVELS) {
    const albedo = atlas.albedo[levelIndex]!, factor = base.width / albedo.width;
    const lit = renderLit(albedo, atlas.normal[levelIndex]!, atlas.material[levelIndex]!, { backlit: false,
      tints: firstTints });
    writeFileSync(join(directory, `view-${view}-mip${levelIndex}.png`),
      encodePng(base.width, base.height, enlarged(lit, albedo.width, albedo.height, factor)));
  }
};

export const writeClimberFoliagePreviews = (atlas: BakedFoliageAtlas, directory: string) =>
  writeFoliagePreviews(atlas, directory, { red: tileTints(RED), white: tileTints(WHITE) });
