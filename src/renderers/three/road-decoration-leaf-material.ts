import { DataTexture, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial, SRGBColorSpace } from "three";

/** One neutral veined leaf map per template owner; plant colour stays in shared geometry vertex colours. */
export const createRoadDecorationLeafMaterial = (detailed: boolean) => {
  const size = detailed ? 128 : 64, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1) - .5, v = y / (size - 1);
    const midrib = Math.exp(-Math.abs(u) * 150);
    const branch = Math.abs(((v * 10 - Math.abs(u) * 5) % 1 + 1) % 1 - .5);
    const veins = Math.exp(-branch * 45) * Math.min(1, Math.abs(u) * 12);
    const grain = Math.sin(x * 17.3 + y * 11.9) * Math.cos(x * 4.7 - y * 15.1);
    const value = Math.round(217 + midrib * 29 + veins * 12 + grain * (detailed ? 3 : 1));
    const index = (y * size + x) * 4;
    pixels[index] = value; pixels[index + 1] = value; pixels[index + 2] = value; pixels[index + 3] = 255;
  }
  const map = new DataTexture(pixels, size, size); map.colorSpace = SRGBColorSpace;
  map.magFilter = LinearFilter; map.minFilter = LinearMipmapLinearFilter; map.generateMipmaps = true; map.needsUpdate = true;
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: .82, map,
    bumpMap: detailed ? map : null, bumpScale: .003 });
  let disposed = false;
  return { material, dispose: () => {
    if (disposed) return; disposed = true; material.dispose(); map.dispose(); map.image.data = null;
  } };
};
