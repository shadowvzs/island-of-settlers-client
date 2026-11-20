import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, UnsignedByteType } from "three";

import { MAPLE_LEAF_OUTLINE } from "./maple-leaf-geometry";

const insideBlade = (x: number, y: number) => {
  let inside = false;
  for (let index = 0, previous = MAPLE_LEAF_OUTLINE.length - 1;
    index < MAPLE_LEAF_OUTLINE.length; previous = index++) {
    const a = MAPLE_LEAF_OUTLINE[index]!, b = MAPLE_LEAF_OUTLINE[previous]!;
    if ((a[1] > y) !== (b[1] > y) &&
      x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};
const coverageAt = (column: number, row: number, size: number) => {
  let covered = 0;
  for (const dy of [.25, .75]) for (const dx of [.25, .75]) {
    const x = (column + dx) / size - .5, y = (row + dy) / size;
    if (insideBlade(x, y) || y < .19 && Math.abs(x) < .013 * (1 - y / .19 * .28)) covered++;
  }
  return Math.round(covered / 4 * 255);
};

/** The same five-lobed source outline, rasterized only for distant two-triangle leaves. */
export const createMapleFarAlpha = () => {
  const size = 256, pixels = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const at = (row * size + column) * 4;
    // Transparent borders prevent clamped texture texels extending a lobe outside its authored silhouette.
    let alpha = coverageAt(column, row, size);
    if (row === size - 1 || column === 0 || column === size - 1) alpha = 0;
    pixels[at] = alpha; pixels[at + 1] = alpha; pixels[at + 2] = alpha; pixels[at + 3] = 255;
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat, UnsignedByteType);
  texture.name = "maple_canonical_palmate_far_alpha";
  texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
};
