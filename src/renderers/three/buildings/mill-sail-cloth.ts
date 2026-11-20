import { ClampToEdgeWrapping, DataTexture, RGBAFormat, SRGBColorSpace } from "three";

import { cachedPixels } from "./building-pixel-cache";
import { createFinishedMillSail, millSailEdgeContact, type MillSailPoint } from "./mill-sail-finish";

type Colour = readonly [number, number, number];

const paintSailCloth = (outline: readonly MillSailPoint[], detailed: boolean,
  paint: (u: number, v: number) => Colour, rounded: boolean) => {
  if (rounded) {
    const finished = createFinishedMillSail(outline, detailed); outline = finished.outline; finished.geometry.dispose();
  }
  const size = detailed ? 256 : 128, pixels = new Uint8Array(size * size * 4);
  const minX = Math.min(...outline.map(point => point[0])), maxX = Math.max(...outline.map(point => point[0]));
  const minY = Math.min(...outline.map(point => point[1])), maxY = Math.max(...outline.map(point => point[1]));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1), v = y / (size - 1), contact = millSailEdgeContact(outline,
      minX + (maxX - minX) * u, minY + (maxY - minY) * v);
    const hem = contact.distance < (detailed ? .008 : .010);
    let colour = paint(u, v);
    if (hem) colour = [193, 178, 147];
    pixels.set([...colour.map(channel => Math.max(0, Math.min(255, Math.round(channel)))), 255],
      (y * size + x) * 4);
  }
  return pixels;
};

/**
 * One cloth map per mechanism, shared by all blades; no trim meshes, detached wires or extra passes.
 * `paintKey` names the paint function: the pixels are cached per paint, outline, detail and rounding.
 */
export const createFinishedMillSailTexture = (outline: readonly MillSailPoint[], detailed: boolean,
  paint: (u: number, v: number) => Colour, paintKey: string, rounded = true) => {
  const size = detailed ? 256 : 128;
  const key = `mill-sail:${paintKey}:${size}:${rounded}:${outline.flat().join(",")}`;
  const pixels = cachedPixels(key, () => paintSailCloth(outline, detailed, paint, rounded));
  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  texture.colorSpace = SRGBColorSpace; texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
};
