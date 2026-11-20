import { CanvasTexture, type MeshStandardMaterial, RepeatWrapping, SRGBColorSpace } from "three";

import { ownBuildingMaterial } from "./building-material-ownership";

/** Neutral woven albedo lets the authored blue/ochre/cream vertex pigments retain their hue. */
export const createPersianAwningMaterial = (source: MeshStandardMaterial, detailed: boolean) => {
  const canvas = document.createElement("canvas"), size = detailed ? 128 : 64;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const pixels = context.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = (y * size + x) * 4;
    const thread = (x % 4 === 0 ? 5 : 0) + (y % 4 === 0 ? 4 : 0);
    const grain = Math.sin(x * 37 + y * 19) * 2;
    const value = Math.round(249 - thread + grain);
    pixels.data[at] = value;
    pixels.data[at + 1] = value;
    pixels.data[at + 2] = value;
    pixels.data[at + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.wrapS = RepeatWrapping;
  map.wrapT = RepeatWrapping;
  map.repeat.set(3, 3);
  const material = source.clone();
  material.name = "persian-neutral-woven-awning";
  material.color.setHex(0xffffff);
  material.map = map;
  material.roughness = .94;
  material.metalness = 0;
  return ownBuildingMaterial(material, source, true);
};
