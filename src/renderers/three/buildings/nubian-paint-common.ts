import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

import type { AtlasRegion } from "./nubian-decor-atlas";
import { blockVariation } from "./surface-detail-common";

/** An atlas canvas with a parallel height field (the High normal map source). */
export interface AtlasPainter {
  context: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  height: Float32Array;
  width: number;
  rows: number;
}

export const createAtlasPainter = (width: number, rows: number): AtlasPainter => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = rows;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  return { canvas, context, height: new Float32Array(width * rows).fill(0.5), rows, width };
};

/** Pixel rectangle of an atlas region (canvas rows run top-down, UV v runs bottom-up). */
export const regionRect = (painter: AtlasPainter, region: AtlasRegion) => {
  const x = Math.round(region.u0 * painter.width),
    y = Math.round((1 - region.v1) * painter.rows);
  return {
    height: Math.round((1 - region.v0) * painter.rows) - y,
    width: Math.round(region.u1 * painter.width) - x,
    x,
    y
  };
};
export type PixelRect = ReturnType<typeof regionRect>;

/** Draws in a region with 0…1 coordinates: x across, y up (v), so motifs follow the mesh UVs. */
export const drawInRegion = (
  painter: AtlasPainter,
  rect: PixelRect,
  draw: (context: CanvasRenderingContext2D) => void
) => {
  const { context } = painter;
  context.save();
  context.beginPath();
  context.rect(rect.x, rect.y, rect.width, rect.height);
  context.clip();
  context.setTransform(rect.width, 0, 0, -rect.height, rect.x, rect.y + rect.height);
  draw(context);
  context.restore();
};

/** Smooth value noise, 0…1, on a lattice of `scale` cells per unit. */
export const valueNoise = (x: number, y: number, seed = 0) => {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy);
  const at = (column: number, row: number) => blockVariation(column + seed * 131, row - seed * 71);
  const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
  const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
  return top + (bottom - top) * sy;
};

/** Three octaves of value noise, 0…1. */
export const fractalNoise = (x: number, y: number, seed = 0) =>
  valueNoise(x, y, seed) * 0.55 +
  valueNoise(x * 2.1, y * 2.1, seed + 1) * 0.3 +
  valueNoise(x * 4.3, y * 4.3, seed + 2) * 0.15;

/** Texel callback: region coordinates 0…1 (u right, v up), pixel colour to adjust, returns height 0…1. */
export type TexelShader = (
  u: number,
  v: number,
  colour: Uint8ClampedArray,
  offset: number
) => number;

/** Runs a per-texel pass over a region: grain, wear and relief after the vector motifs. */
export const shadeRegion = (painter: AtlasPainter, rect: PixelRect, shader: TexelShader) => {
  const image = painter.context.getImageData(rect.x, rect.y, rect.width, rect.height);
  for (let row = 0; row < rect.height; row++)
    for (let column = 0; column < rect.width; column++) {
      const offset = (row * rect.width + column) * 4;
      const height = shader(
        (column + 0.5) / rect.width,
        1 - (row + 0.5) / rect.height,
        image.data,
        offset
      );
      painter.height[(rect.y + row) * painter.width + rect.x + column] = height;
    }
  painter.context.putImageData(image, rect.x, rect.y);
};

/** Multiplies a texel's colour (and optionally tints it towards `towards` by `amount`). */
export const scaleTexel = (data: Uint8ClampedArray, offset: number, factor: number) => {
  data[offset] = data[offset]! * factor;
  data[offset + 1] = data[offset + 1]! * factor;
  data[offset + 2] = data[offset + 2]! * factor;
};

export const mixTexel = (
  data: Uint8ClampedArray,
  offset: number,
  colour: readonly number[],
  amount: number
) => {
  for (let channel = 0; channel < 3; channel++)
    data[offset + channel] =
      data[offset + channel]! + (colour[channel]! - data[offset + channel]!) * amount;
};

const toTexture = (canvas: HTMLCanvasElement, colour: boolean) => {
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  texture.userData.mimeType = "image/png";
  if (colour) texture.colorSpace = SRGBColorSpace;
  return texture;
};

export const albedoTexture = (painter: AtlasPainter) => toTexture(painter.canvas, true);

/** Tangent-space normal map from the height field (relief scaled per texel resolution). */
export const normalTexture = (painter: AtlasPainter, strength: number) => {
  const { height, rows, width } = painter,
    canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = rows;
  const context = canvas.getContext("2d")!,
    image = context.createImageData(width, rows);
  const at = (x: number, y: number) =>
    height[Math.min(rows - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]!;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < width; x++) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * strength,
        ny = (at(x, y + 1) - at(x, y - 1)) * strength;
      const length = Math.hypot(nx, ny, 1),
        offset = (y * width + x) * 4;
      image.data.set(
        [(nx / length + 1) * 127.5, (ny / length + 1) * 127.5, (1 / length + 1) * 127.5, 255],
        offset
      );
    }
  context.putImageData(image, 0, 0);
  return toTexture(canvas, false);
};

/** Shorthand for filling a closed polygon in region coordinates. */
export const polygon = (
  context: CanvasRenderingContext2D,
  points: ReadonlyArray<readonly [number, number]>,
  fill: string
) => {
  context.beginPath();
  points.forEach(([x, y], index) => (index ? context.lineTo(x, y) : context.moveTo(x, y)));
  context.closePath();
  context.fillStyle = fill;
  context.fill();
};

export const band = (context: CanvasRenderingContext2D, from: number, to: number, fill: string) => {
  context.fillStyle = fill;
  context.fillRect(-0.01, from, 1.02, to - from);
};
