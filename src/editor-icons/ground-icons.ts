import { MATERIAL_SEED } from "../app/asset-seeds";
import {
  generateMaterialLayer,
  MATERIAL_TILE_SIZE,
  type MaterialLayer
} from "../render-common/materials/material-textures";
import { createCanvas, getContext } from "./icon-fit";

/** Share of the tile edge an icon shows (a few cells of ground). */
const CROP = 0.5;
/** Soft light over the tile's relief: ambient, sun share and the sun direction (x, up, z). */
const LIGHT = { ambient: 0.62, sun: 0.48 } as const;
const SUN = (() => {
  const [x, y, z] = [-0.45, 0.75, -0.5];
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length] as const;
})();
/** Rounded corner radius of a tile icon (share of its edge). */
const CORNER = 0.16;

/** Albedo lit by the normal map and its occlusion (one texel, 0..255 per channel). */
const shadeTexel = (layer: MaterialLayer, index: number, target: Uint8ClampedArray) => {
  const { albedoHeight: albedo, normalRoughness: normals } = layer;
  const nx = normals[index]! / 127.5 - 1;
  const nz = normals[index + 1]! / 127.5 - 1;
  const ny = Math.sqrt(Math.max(0, 1 - nx * nx - nz * nz));
  const facing = Math.max(0, nx * SUN[0] + ny * SUN[1] + nz * SUN[2]);
  const light = (LIGHT.ambient + LIGHT.sun * facing) * (normals[index + 2]! / 255);
  for (let channel = 0; channel < 3; channel += 1) {
    target[index + channel] = albedo[index + channel]! * light;
  }
  target[index + 3] = 255;
};

const tiles = new Map<number, HTMLCanvasElement>();

/** The material's painted tile (the terrain's own texture), lit, as a canvas (made once). */
export const paintTile = (material: number) => {
  const known = tiles.get(material);
  if (known) return known;
  const size = MATERIAL_TILE_SIZE;
  const layer = generateMaterialLayer(material, size, MATERIAL_SEED);
  const canvas = createCanvas(size, size);
  const context = getContext(canvas);
  const image = context.createImageData(size, size);
  for (let index = 0; index < size * size * 4; index += 4) shadeTexel(layer, index, image.data);
  context.putImageData(image, 0, 0);
  tiles.set(material, canvas);
  return canvas;
};

/** A square of the material's ground with rounded corners (transparent outside). */
export const renderTileIcon = (material: number) => {
  const tile = paintTile(material);
  const edge = Math.round(MATERIAL_TILE_SIZE * CROP);
  const canvas = createCanvas(edge, edge);
  const context = getContext(canvas);
  context.beginPath();
  context.roundRect(0, 0, edge, edge, edge * CORNER);
  context.clip();
  context.drawImage(tile, 0, 0, edge, edge, 0, 0, edge, edge);
  return canvas;
};
