import { writeFileSync } from "node:fs";

import { createFoliageAtlas } from "../../src/render-common/trees/foliage-atlas";
import { encodePng } from "./png";

/** Writes the tree foliage atlas (over grey, v up) to inspect the painted sprays and fronds. */
const atlas = createFoliageAtlas(7);
const preview = new Uint8Array(atlas.color.length);
const rowBytes = atlas.width * 4;
for (let row = 0; row < atlas.height; row += 1) {
  for (let column = 0; column < atlas.width; column += 1) {
    const source = row * rowBytes + column * 4;
    const target = (atlas.height - 1 - row) * rowBytes + column * 4;
    const alpha = atlas.color[source + 3]! / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      preview[target + channel] = atlas.color[source + channel]! * alpha + 200 * (1 - alpha);
    }
    preview[target + 3] = 255;
  }
}
writeFileSync(process.argv[2] ?? "tree-atlas.png", encodePng(atlas.width, atlas.height, preview));
