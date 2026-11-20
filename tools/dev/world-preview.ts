import { writeFileSync } from "node:fs";

import {
  DEFAULT_WORLD_OPTIONS,
  generateWorld
} from "../../src/shared/world/generation/generate-world";
import { MATERIAL_COUNT } from "../../src/shared/world/world-data";
import { encodePng } from "./png";

const COLORS = [
  [96, 150, 60],
  [70, 140, 45],
  [70, 85, 40],
  [140, 105, 70],
  [220, 200, 150],
  [125, 120, 115],
  [240, 245, 250],
  [210, 160, 90]
];
const PROP_COLORS = [
  [20, 70, 20],
  [10, 50, 30],
  [200, 230, 120],
  [50, 110, 40],
  [90, 90, 90],
  [60, 60, 60],
  [230, 80, 200],
  [200, 120, 60],
  [160, 180, 60]
];

const seed = Number(process.argv[2] ?? DEFAULT_WORLD_OPTIONS.seed);
const out = process.argv[3] ?? "preview.png";
const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, seed });
const scale = 4;
const stride = world.cellsX + 1;
const width = stride * scale;
const height = (world.cellsZ + 1) * scale;
const rgba = new Uint8Array(width * height * 4);
for (let py = 0; py < height; py += 1) {
  for (let px = 0; px < width; px += 1) {
    const v = Math.floor(py / scale) * stride + Math.floor(px / scale);
    let r = 0,
      g = 0,
      b = 0;
    for (let m = 0; m < MATERIAL_COUNT; m += 1) {
      const w = world.splat[v * MATERIAL_COUNT + m]! / 255;
      r += COLORS[m]![0]! * w;
      g += COLORS[m]![1]! * w;
      b += COLORS[m]![2]! * w;
    }
    const n = world.normals;
    const light =
      Math.max(0, -n[v * 3]! * 0.7 + n[v * 3 + 1]! * 0.7) *
      (0.5 + (0.5 * world.sunShadow[v]!) / 255) *
      (world.ambientOcclusion[v]! / 255);
    const shade = 0.35 + light * 0.9;
    r *= shade;
    g *= shade;
    b *= shade;
    const depth = world.waterDepth[v]!;
    if (depth > 0) {
      const a = Math.min(0.9, 0.35 + depth * 0.25);
      r = r * (1 - a) + 30 * a;
      g = g * (1 - a) + 90 * a;
      b = b * (1 - a) + 140 * a;
    }
    const o = (py * width + px) * 4;
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = 255;
  }
}
const { props } = world;
for (let i = 0; i < props.count; i += 1) {
  const cx = Math.round(props.x[i]! * scale),
    cz = Math.round(props.z[i]! * scale);
  const c = PROP_COLORS[props.types[i]!]!;
  for (let dy = -1; dy <= 1; dy += 1)
    for (let dx = -1; dx <= 1; dx += 1) {
      const o = ((cz + dy) * width + cx + dx) * 4;
      if (o >= 0 && o < rgba.length) {
        rgba[o] = c[0]!;
        rgba[o + 1] = c[1]!;
        rgba[o + 2] = c[2]!;
      }
    }
}
writeFileSync(out, encodePng(width, height, rgba));
console.log("written", out);
