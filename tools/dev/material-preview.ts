import { writeFileSync } from "node:fs";

import {
  generateMaterialLayer,
  MATERIAL_TILE_SIZE,
  packGroundLayers
} from "../../src/render-common/materials/material-textures";
import { MATERIAL_COUNT } from "../../src/shared/world/world-data";
import { encodePng } from "./png";

/**
 * Writes the albedo layers to `out` and normal (RG) + AO (B) to `out` with a `-normal` suffix, as one
 * column of tiles (the texture array's layer order, top to bottom).
 */
const out = process.argv[2] ?? "materials.png";
const started = performance.now();
const layers = Array.from({ length: MATERIAL_COUNT }, (_, material) => {
  const t = performance.now();
  const layer = generateMaterialLayer(material, MATERIAL_TILE_SIZE, 1234);
  console.log("material", material, Math.round(performance.now() - t), "ms");
  return layer;
});
const set = packGroundLayers(layers);
console.log("total", Math.round(performance.now() - started), "ms");

const writeOpaque = (path: string, pixels: Uint8Array) => {
  const rgba = Uint8Array.from(pixels);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  writeFileSync(path, encodePng(set.size, set.size * set.layerCount, rgba));
};

writeOpaque(out, set.albedoHeight);
writeOpaque(out.replace(/\.png$/, "-normal.png"), set.normalRoughness);
