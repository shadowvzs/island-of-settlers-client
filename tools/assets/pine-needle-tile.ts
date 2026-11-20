import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Bakes the procedural pine-needle floor tile (GROUND-PALETTE step 3, owner 2026-11-17) into the ground layer format
 * of the variant tiles (`pine-needles-albedo.png`, `-relief.png`, `-surface.png`, 512², see ground-variant-tiles.ts):
 * dark soil, small green patches showing through, thousands of overlapping needles (rust, tan, brown, a few fresh
 * green ones) and a few scaled cones. Seeded and tileable (every stroke wraps), so a re-run is byte-identical.
 * Usage (from island-of-settlers-client): npx tsx tools/assets/pine-needle-tile.ts
 *   `SHARP` overrides the sharp module path (default: the asset-tools checkout beside the client).
 */
const SIZE = 512;
const NEEDLES = 15000;
const CONES = 5;
const OUTPUT = resolve(import.meta.dirname, "../../assets/ground-variants");
const SHARP = process.env.SHARP ?? resolve(import.meta.dirname,
  "../../../island-of-settlers-asset-tools/node_modules/sharp/dist/index.mjs");

type Rgb = readonly [number, number, number];
const SOIL: Rgb = [62, 47, 33];
const GREEN: Rgb = [70, 96, 40];
/** Dry needle colours (most), and the share of fresh green needles. */
const NEEDLE_COLOURS: readonly Rgb[] = [[112, 78, 52], [134, 104, 74], [90, 62, 40], [106, 92, 76], [122, 90, 60]];
const FRESH: Rgb = [84, 100, 48];
const CONE: Rgb = [112, 70, 38];

const createRandom = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};
const random = createRandom(0x9e3779b1);
const wrap = (value: number) => ((Math.round(value) % SIZE) + SIZE) % SIZE;
const smoothstep = (from: number, to: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** Tileable value noise (lattice `cells` per tile edge). */
const createNoise = (cells: number) => {
  const lattice = Array.from({ length: cells * cells }, () => random());
  const at = (x: number, y: number) => lattice[(y % cells) * cells + (x % cells)]!;
  return (px: number, py: number) => {
    const x = px / SIZE * cells, y = py / SIZE * cells;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smoothstep(0, 1, x - x0), fy = smoothstep(0, 1, y - y0);
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return top + (bottom - top) * fy;
  };
};

const albedo = new Float32Array(SIZE * SIZE * 3);
const height = new Float32Array(SIZE * SIZE);
const roughness = new Float32Array(SIZE * SIZE).fill(0.88);
const greenPatches = new Float32Array(SIZE * SIZE);

const paint = (index: number, colour: Rgb, share: number) => {
  for (let channel = 0; channel < 3; channel += 1) {
    const at = index * 3 + channel;
    albedo[at] = albedo[at]! + (colour[channel]! - albedo[at]!) * share;
  }
};

/** Soil with a slow tone and small green patches (moss, grass shoots) that the needles leave partly open. */
const paintGround = () => {
  const tone = createNoise(6), patches = createNoise(14), fine = createNoise(64);
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    const index = y * SIZE + x;
    const shade = 0.85 + tone(x, y) * 0.3;
    const soil: Rgb = [SOIL[0] * shade, SOIL[1] * shade, SOIL[2] * shade];
    albedo.set(soil, index * 3);
    greenPatches[index] = smoothstep(0.6, 0.75, patches(x, y) * 0.8 + fine(x, y) * 0.2);
    paint(index, GREEN, greenPatches[index]! * 0.9);
    height[index] = fine(x, y) * 0.15 + greenPatches[index]! * 0.12;
  }
};

/** One needle: a thin antialiased stroke laid on top of what is there (it rises above its bed). */
const drawNeedle = () => {
  const cx = random() * SIZE, cy = random() * SIZE;
  if (greenPatches[wrap(cy) * SIZE + wrap(cx)]! > 0.5 && random() < 0.65) return;
  const angle = random() * Math.PI, length = 7 + random() * 8, width = 0.55 + random() * 0.35;
  const fresh = random() < 0.06;
  const base = fresh ? FRESH : NEEDLE_COLOURS[Math.floor(random() * NEEDLE_COLOURS.length)]!;
  const bright = 0.85 + random() * 0.3;
  const colour: Rgb = [base[0] * bright, base[1] * bright, base[2] * bright];
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const bed = height[wrap(cy) * SIZE + wrap(cx)]!;
  for (let t = -length / 2; t <= length / 2; t += 0.5) {
    const sx = cx + dx * t, sy = cy + dy * t;
    for (let oy = -1; oy <= 1; oy += 1) for (let ox = -1; ox <= 1; ox += 1) {
      const px = Math.round(sx) + ox, py = Math.round(sy) + oy;
      const across = Math.abs((px - sx) * -dy + (py - sy) * dx);
      const cover = 1 - smoothstep(width * 0.6, width + 0.6, across);
      if (cover <= 0) continue;
      const index = wrap(py) * SIZE + wrap(px);
      paint(index, colour, cover);
      height[index] = Math.max(height[index]!, bed + 0.05 + 0.04 * cover);
      roughness[index] = 0.8;
    }
  }
};

/** A pine cone: an elongated dome with rows of overlapping scales (dark gaps between them). */
const drawCone = () => {
  const cx = random() * SIZE, cy = random() * SIZE, angle = random() * Math.PI * 2;
  const length = 19 + random() * 6, radius = length * 0.34;
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const reach = Math.ceil(length / 2 + 2);
  for (let oy = -reach; oy <= reach; oy += 1) for (let ox = -reach; ox <= reach; ox += 1) {
    const along = (ox * dx + oy * dy) / (length / 2);
    const across = (-ox * dy + oy * dx) / (radius * (1 - Math.max(0, along) * 0.45));
    const distance = along * along + across * across;
    if (distance >= 1) continue;
    const dome = Math.sqrt(1 - distance);
    const scales = Math.sin(along * 9 + Math.abs(across) * 3.5) * Math.sin(across * 4.5);
    const gap = smoothstep(0.35, 0.9, Math.abs(scales));
    const shade = (0.55 + dome * 0.6) * (1 - gap * 0.5) + (1 - gap) * dome * 0.15;
    const index = wrap(cy + oy) * SIZE + wrap(cx + ox);
    paint(index, [CONE[0] * shade, CONE[1] * shade, CONE[2] * shade], smoothstep(1, 0.8, distance));
    height[index] = Math.max(height[index]!, 0.35 + dome * 0.75 - gap * 0.08);
    roughness[index] = 0.7;
  }
};

/** Height to the tiles' bytes (mean 128, deviation about 40) and the normal (-dh/dx, -dh/drow) in G / B. */
const packRelief = () => {
  let sum = 0, square = 0;
  for (const value of height) { sum += value; square += value * value; }
  const mean = sum / height.length, deviation = Math.sqrt(Math.max(1e-6, square / height.length - mean * mean));
  const out = Buffer.alloc(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    const index = y * SIZE + x;
    const slopeX = (height[y * SIZE + wrap(x + 1)]! - height[y * SIZE + wrap(x - 1)]!) * 6;
    const slopeY = (height[wrap(y + 1) * SIZE + x]! - height[wrap(y - 1) * SIZE + x]!) * 6;
    const length = Math.hypot(slopeX, slopeY, 1);
    out[index * 3] = clampByte(128 + (height[index]! - mean) / deviation * 40);
    out[index * 3 + 1] = clampByte(128 - slopeX / length * 127);
    out[index * 3 + 2] = clampByte(128 - slopeY / length * 127);
  }
  return out;
};

/** Ambient occlusion from the height (texels below their neighbourhood) and the roughness. */
const packSurface = () => {
  const out = Buffer.alloc(SIZE * SIZE * 3);
  const radius = 3;
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    let around = 0;
    for (let oy = -radius; oy <= radius; oy += radius) for (let ox = -radius; ox <= radius; ox += radius) {
      around += height[wrap(y + oy) * SIZE + wrap(x + ox)]!;
    }
    const index = y * SIZE + x;
    const hidden = Math.max(0, around / 9 - height[index]!);
    out[index * 3] = clampByte((1 - Math.min(0.55, hidden * 2.2)) * 255);
    out[index * 3 + 1] = clampByte(roughness[index]! * 255);
  }
  return out;
};

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

type SharpWriter = (input: Buffer, options: { raw: { channels: 3; height: number; width: number } }) => {
  png: (options: { compressionLevel: number }) => { toFile: (path: string) => Promise<unknown> };
};
const sharp = (await import(SHARP)).default as SharpWriter;
const writePng = (data: Buffer, name: string) =>
  sharp(data, { raw: { channels: 3, height: SIZE, width: SIZE } }).png({ compressionLevel: 9 })
    .toFile(join(OUTPUT, name));

paintGround();
for (let needle = 0; needle < NEEDLES; needle += 1) drawNeedle();
for (let cone = 0; cone < CONES; cone += 1) drawCone();
mkdirSync(OUTPUT, { recursive: true });
await writePng(Buffer.from(Array.from(albedo, clampByte)), "pine-needles-albedo.png");
await writePng(packRelief(), "pine-needles-relief.png");
await writePng(packSurface(), "pine-needles-surface.png");
console.log("pine-needles: written to", OUTPUT);
