import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { MATERIAL_SEED } from "../../../src/app/asset-seeds";
import type { AtlasMip } from "../../../src/render-common/baker/atlas-mips";
import { toByte } from "../../../src/render-common/color";
import { generateMaterialLayer, MATERIAL_TILE_SIZE } from "../../../src/render-common/materials/material-textures";
import { MICRO_CLASS_IDS, MICRO_CLASS_OF_MATERIAL, MICRO_DETAIL_ALBEDO_SCALE,
  MICRO_DETAIL_TILE_SIZE } from "../../../src/render-common/materials/micro-detail";
import { MATERIAL_TILE_UNITS } from "../../../src/render-common/shaders/ground-common-glsl";
import { MATERIAL } from "../../../src/shared/world/world-data";
import { encodePng } from "../../dev/png";
import { type BakedMicroDetailAtlas, halveRgbaTile } from "./atlas-bake";
import { type BaseGround, type NearMode, shadeGroundPoint } from "./preview-shading";

/**
 * Deterministic CPU review images of the micro-detail atlas. They are texture reviews, not game
 * captures (O9): raw channels, 3×3 tiling per class, and "today | T06b" comparisons of the real
 * ground tiles in a magnified close-up, the possessed eye view and the possessed spyglass.
 */

const PREVIEW_MATERIALS = ["grass", "forestFloor", "dirt", "mine", "sand", "gravel", "snow"] as const;
/** Flat review colours per class for the tiling sheets (display sRGB 0..1). */
const CLASS_COLOURS: readonly [number, number, number][] = [[0.36, 0.5, 0.2], [0.42, 0.33, 0.23],
  [0.78, 0.69, 0.5], [0.9, 0.92, 0.95]];
const EYE_HEIGHT = 0.967;
const SKY = [168, 192, 214] as const;

interface ViewSetup {
  /** Downward pitch in degrees. */
  pitch: number;
  /** Vertical field of view in degrees (68 eye; 22.7 for the 3× spyglass, `movement.ts`). */
  verticalFov: number;
}

const POSSESSED: ViewSetup = { pitch: 24, verticalFov: 68 };
const SPYGLASS: ViewSetup = { pitch: 6, verticalFov: 22.7 };

const writePng = (directory: string, name: string, width: number, height: number, rgba: Uint8Array) =>
  writeFileSync(join(directory, name), encodePng(width, height, rgba));

const writeChannels = (atlas: BakedMicroDetailAtlas, directory: string) => {
  const { data, height, width } = atlas.levels[0]!;
  const channel = (pick: (offset: number) => [number, number, number]) => {
    const rgba = new Uint8Array(data.length);
    for (let offset = 0; offset < data.length; offset += 4) rgba.set([...pick(offset), 255], offset);
    return rgba;
  };
  writePng(directory, "atlas-albedo-multiplier.png", width, height, channel(offset => {
    const value = toByte((data[offset + 2]! / MICRO_DETAIL_ALBEDO_SCALE) * 0.5);
    return [value, value, value];
  }));
  writePng(directory, "atlas-normal.png", width, height, channel(offset => [data[offset]!, data[offset + 1]!, 255]));
  writePng(directory, "atlas-height.png", width, height, channel(offset => {
    const value = data[offset + 3]!;
    return [value, value, value];
  }));
};

/** 3×3 repeats of each class tile under the review light: shows whether the repeat is visible. */
const writeTiling = (atlas: BakedMicroDetailAtlas, directory: string) => {
  const size = MICRO_DETAIL_TILE_SIZE, sheet = size * 3;
  atlas.tiles.forEach((tile, microClass) => {
    const rgba = new Uint8Array(sheet * sheet * 4), colour = CLASS_COLOURS[microClass]!;
    for (let y = 0; y < sheet; y += 1) for (let x = 0; x < sheet; x += 1) {
      const from = ((y % size) * size + (x % size)) * 4, to = (y * sheet + x) * 4;
      const nx = tile[from]! / 127.5 - 1, nz = tile[from + 1]! / 127.5 - 1;
      const diffuse = Math.max(0, (-0.42 * nx + 0.78 + 0.46 * nz) / Math.hypot(nx, 1, nz));
      const light = (0.82 * diffuse + 0.42 * (1 + (tile[from + 3]! / 255 - 0.5) * 0.18)) * tile[from + 2]! / 127.5;
      rgba.set([toByte(colour[0] * light), toByte(colour[1] * light), toByte(colour[2] * light), 255], to);
    }
    writePng(directory, `tiling-${MICRO_CLASS_IDS[microClass]}.png`, sheet, sheet, rgba);
  });
};

const mipChain = (pixels: Uint8Array, size: number, smallest: number) => {
  const levels: AtlasMip[] = [{ data: pixels, height: size, width: size }];
  for (let level = size; level > smallest; level /= 2) {
    levels.push({ data: halveRgbaTile(levels.at(-1)!.data, level), height: level / 2, width: level / 2 });
  }
  return levels;
};

const loadBaseGround = (material: number): BaseGround => {
  const layer = generateMaterialLayer(material, MATERIAL_TILE_SIZE, MATERIAL_SEED);
  return { albedo: mipChain(layer.albedoHeight, MATERIAL_TILE_SIZE, 4),
    normal: mipChain(layer.normalRoughness, MATERIAL_TILE_SIZE, 4), units: MATERIAL_TILE_UNITS[material]! };
};

/** Top-down close-up of 1.2 × 1.2 units at ≈ 530 px per unit (eye distance ≈ 1.5 units). */
const renderCloseUp = (base: BaseGround, atlas: BakedMicroDetailAtlas, material: number, mode: NearMode) => {
  const size = 640, units = 1.2, step = units / size, rgba = new Uint8Array(size * size * 4);
  const footprint = { major: step, minor: step };
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    shadeGroundPoint(base, { footprint, microAtlas: atlas.levels, microClass: MICRO_CLASS_OF_MATERIAL[material]!,
      mode, x: x * step, z: y * step }, rgba, (y * size + x) * 4);
  }
  return { height: size, rgba, width: size };
};

/** The ground point under a screen pixel of a camera at eye height, looking along +z. */
const castRay = (view: ViewSetup, width: number, height: number, px: number, py: number) => {
  const tanHalf = Math.tan((view.verticalFov * Math.PI) / 360), pitch = (view.pitch * Math.PI) / 180;
  const sx = ((px / width) * 2 - 1) * tanHalf * (width / height), sy = (1 - (py / height) * 2) * tanHalf;
  const dirY = sy * Math.cos(pitch) - Math.sin(pitch), dirZ = sy * Math.sin(pitch) + Math.cos(pitch);
  if (dirY >= -1e-4) return null;
  const distance = EYE_HEIGHT / -dirY;
  return { x: sx * distance, z: dirZ * distance };
};

const renderView = (base: BaseGround, atlas: BakedMicroDetailAtlas, material: number, mode: NearMode,
  view: ViewSetup) => {
  const width = 960, height = 540, rgba = new Uint8Array(width * height * 4);
  for (let py = 0; py < height; py += 1) for (let px = 0; px < width; px += 1) {
    const offset = (py * width + px) * 4, hit = castRay(view, width, height, px, py);
    const right = castRay(view, width, height, px + 1, py), down = castRay(view, width, height, px, py + 1);
    if (!hit || !right || !down || hit.z > 80) {
      rgba.set([...SKY, 255], offset);
      continue;
    }
    const along = Math.hypot(down.x - hit.x, down.z - hit.z), across = Math.hypot(right.x - hit.x, right.z - hit.z);
    const footprint = { major: Math.max(along, across), minor: Math.min(along, across) };
    shadeGroundPoint(base, { footprint, microAtlas: atlas.levels, microClass: MICRO_CLASS_OF_MATERIAL[material]!,
      mode, x: hit.x + 37.3, z: hit.z + 11.1 }, rgba, offset);
  }
  return { height, rgba, width };
};

type Image = { height: number; rgba: Uint8Array; width: number };

/** "Today" on the left (or top), "T06b micro detail" on the right (or bottom), 8 px gutter. */
const joinImages = (first: Image, second: Image, sideBySide: boolean): Image => {
  const width = sideBySide ? first.width * 2 + 8 : first.width;
  const height = sideBySide ? first.height : first.height * 2 + 8;
  const rgba = new Uint8Array(width * height * 4).fill(255);
  [first, second].forEach((image, index) => {
    const left = sideBySide ? index * (first.width + 8) : 0, top = sideBySide ? 0 : index * (first.height + 8);
    for (let y = 0; y < image.height; y += 1) {
      rgba.set(image.rgba.subarray(y * image.width * 4, (y + 1) * image.width * 4), ((top + y) * width + left) * 4);
    }
  });
  return { height, rgba, width };
};

const writeComparisons = (atlas: BakedMicroDetailAtlas, directory: string) => {
  for (const name of PREVIEW_MATERIALS) {
    const material = MATERIAL[name], base = loadBaseGround(material);
    const closeUp = joinImages(renderCloseUp(base, atlas, material, "today"),
      renderCloseUp(base, atlas, material, "micro"), true);
    writePng(directory, `closeup-${name}.png`, closeUp.width, closeUp.height, closeUp.rgba);
    for (const [label, view] of [["possessed", POSSESSED], ["spyglass", SPYGLASS]] as const) {
      const image = joinImages(renderView(base, atlas, material, "today", view),
        renderView(base, atlas, material, "micro", view), false);
      writePng(directory, `${label}-${name}.png`, image.width, image.height, image.rgba);
    }
  }
};

export const writeMicroDetailPreviews = (atlas: BakedMicroDetailAtlas, directory: string) => {
  mkdirSync(directory, { recursive: true });
  writeChannels(atlas, directory);
  writeTiling(atlas, directory);
  writeComparisons(atlas, directory);
  console.log(`Micro-detail previews -> ${directory}`);
};
