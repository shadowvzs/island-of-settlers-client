import {
  CanvasTexture, ClampToEdgeWrapping, DataTexture, LinearMipmapLinearFilter, MeshStandardMaterial,
  SRGBColorSpace, type Texture, Vector2
} from "three";

import { ownBuildingMaterial } from "./building-material-ownership";

type FurMaps = { albedo: Texture; normal?: Texture };
const maps = new Map<boolean, FurMaps>();
const random = (x: number, y: number, salt = 0) => {
  const value = Math.sin(x * 127.1 + y * 311.7 + salt * 91.3) * 43758.5453;
  return value - Math.floor(value);
};

const paintStrandPoint = (pixels: Uint8ClampedArray, heights: Float32Array, size: number,
  px: number, py: number, alpha: number, colour: readonly number[]) => {
  const ix = Math.floor(px), iy = Math.floor(py);
  for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
    const x = ix + dx, y = iy + dy;
    if (x < 0 || x >= size || y < 0 || y >= size) continue;
    const coverage = (1 - Math.abs(px - x)) * (1 - Math.abs(py - y)) * alpha;
    const at = y * size + x, offset = at * 4;
    for (let channel = 0; channel < 3; channel++) pixels[offset + channel] =
      pixels[offset + channel]! * (1 - coverage) + colour[channel]! * coverage;
    heights[at] = heights[at]! + coverage * .3;
  }
};

/** Individual tapered strands overlap along the pelt's natural spine-to-flank flow. */
const paintFur = (size: number) => {
  const pixels = new Uint8ClampedArray(size * size * 4), heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = (y * size + x) * 4, u = x / size - .5;
    const spine = Math.exp(-((u / .16) ** 2)), mottling = random(x >> 3, y >> 3) * 9;
    pixels.set([92 - spine * 17 + mottling, 57 - spine * 11 + mottling * .6,
      32 - spine * 5 + mottling * .3, 255], at);
  }
  const spacing = 3, scale = size / 512;
  for (let y = -16; y < size; y += spacing) for (let x = -8; x < size + 8; x += spacing) {
    const startX = x + random(x, y) * spacing, startY = y + random(x, y, 1) * spacing;
    const u = startX / size - .5, side = Math.tanh(u * 7);
    const length = (10 + random(x, y, 2) * 16) * scale;
    const directionX = side * .42 + (random(x, y, 3) - .5) * .30;
    const directionY = .85 + random(x, y, 4) * .2;
    const light = .6 + random(x, y, 5) * .55, colour = [126 * light, 80 * light, 45 * light];
    const steps = Math.ceil(length);
    for (let step = 0; step <= steps; step++) {
      const t = step / steps, bend = Math.sin(t * Math.PI) * scale;
      const px = startX + directionX * step + bend * side, py = startY + directionY * step;
      paintStrandPoint(pixels, heights, size, px, py, Math.sin(t * Math.PI) * .7, colour);
    }
  }
  return { heights, pixels };
};

const normalPixels = (heights: Float32Array, size: number) => {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const at = (x: number, y: number) => heights[Math.max(0, Math.min(size - 1, y)) * size +
    Math.max(0, Math.min(size - 1, x))]!;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * .75;
    const dy = (at(x, y + 1) - at(x, y - 1)) * .75, length = Math.hypot(dx, dy, 1);
    pixels.set([128 - dx / length * 127, 128 + dy / length * 127, 128 + 127 / length, 255],
      (y * size + x) * 4);
  }
  return pixels;
};

const textureFor = (pixels: Uint8ClampedArray, size: number) => {
  let texture: Texture;
  if (typeof document === "undefined" || typeof ImageData === "undefined")
    texture = new DataTexture(new Uint8Array(pixels), size, size);
  else {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels), size, size), 0, 0);
    texture = new CanvasTexture(canvas);
  }
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  texture.minFilter = LinearMipmapLinearFilter; texture.generateMipmaps = true;
  texture.userData.mimeType = "image/png"; texture.needsUpdate = true;
  return texture;
};

/** Maps have one ownership count across every building/ghost; the last owner releases the cache. */
export const createIndigenousFloorHideMaterial = (detailed: boolean) => {
  let shared = maps.get(detailed);
  if (!shared) {
    const size = detailed ? 512 : 256, painted = paintFur(size);
    shared = { albedo: textureFor(painted.pixels, size) };
    shared.albedo.colorSpace = SRGBColorSpace;
    if (detailed) shared.normal = textureFor(normalPixels(painted.heights, size), size);
    maps.set(detailed, shared);
    shared.albedo.addEventListener("dispose", () => { if (maps.get(detailed) === shared) maps.delete(detailed); });
  }
  return ownBuildingMaterial(new MeshStandardMaterial({
    color: "#ffffff", map: shared.albedo, metalness: 0, normalMap: shared.normal ?? null,
    normalScale: new Vector2(.65, .65), roughness: .96, vertexColors: true
  }), undefined, true);
};
