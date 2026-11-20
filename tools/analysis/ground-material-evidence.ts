import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  generateMaterialLayer, GROUND_LAYER_COUNT, MATERIAL_TILE_SIZE, packGroundLayers
} from "../../src/render-common/materials/material-textures";
import { encodePng } from "../dev/png";

const variant = process.argv[2] ?? "candidate";
const output = resolve("../resources/project-reviews/ground-materials-2026-11-02", variant);
if (variant === "baseline" && existsSync(resolve(output, "painter.json")))
  throw new Error("The original painter receipt is already recorded; preserve its baseline sources and outputs.");
mkdirSync(output, { recursive: true });
const seed = 1234, size = MATERIAL_TILE_SIZE;
const hash = (pixels: Uint8Array) => createHash("sha256").update(pixels).digest("hex");
mkdirSync(resolve(output, "source"), { recursive: true });
const sourceManifest = readdirSync("src/render-common/materials").filter(name => name.endsWith(".ts")).map(name => {
  const path = `src/render-common/materials/${name}`, data = readFileSync(path);
  writeFileSync(resolve(output, "source", name), data);
  return { path, sha256: hash(data), bytes: data.byteLength };
});
writeFileSync(resolve(output, "source-manifest.json"), `${JSON.stringify(sourceManifest, null, 2)}\n`);
const channels = (pixels: Uint8Array) => [0, 1, 2, 3].map(channel => {
  let sum = 0, sumSquared = 0, interiorX = 0, interiorY = 0, seamX = 0, seamY = 0;
  const count = size * size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const value = pixels[(y * size + x) * 4 + channel]!;
    sum += value; sumSquared += value * value;
    const dx = Math.abs(value - pixels[(y * size + (x + 1) % size) * 4 + channel]!);
    const dy = Math.abs(value - pixels[(((y + 1) % size) * size + x) * 4 + channel]!);
    interiorX += dx; interiorY += dy;
    if (x === size - 1) seamX += dx;
    if (y === size - 1) seamY += dy;
  }
  const mean = sum / count;
  return { mean, deviation: Math.sqrt(sumSquared / count - mean * mean),
    seamX: seamX * size / interiorX, seamY: seamY * size / interiorY };
});
const reports: unknown[] = [];
const layers = Array.from({ length: GROUND_LAYER_COUNT }, (_, material) => {
  const start = performance.now(), layer = generateMaterialLayer(material, size, seed);
  reports.push({ material, generationMs: performance.now() - start,
    albedoHeight: { bytes: layer.albedoHeight.byteLength, channels: channels(layer.albedoHeight), sha256: hash(layer.albedoHeight) },
    normalRoughness: { bytes: layer.normalRoughness.byteLength, channels: channels(layer.normalRoughness), sha256: hash(layer.normalRoughness) } });
  return layer;
});
const set = packGroundLayers(layers);
for (const [name, pixels] of [["albedo", set.albedoHeight], ["normal-occlusion", set.normalRoughness]] as const) {
  const preview = pixels.slice();
  for (let index = 3; index < preview.length; index += 4) preview[index] = 255;
  // One column of tiles in the texture array's layer order.
  writeFileSync(resolve(output, `${name}.png`), encodePng(set.size, set.size * set.layerCount, preview));
}
const receipt = { variant, seed, size, layerCount: set.layerCount,
  baseTextureBytes: set.albedoHeight.byteLength + set.normalRoughness.byteLength,
  runtimeSamplers: 2, reports };
writeFileSync(resolve(output, "painter.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ ...receipt, reports: reports.map((row: any) => ({ material: row.material, generationMs: row.generationMs })) }, null, 2));
