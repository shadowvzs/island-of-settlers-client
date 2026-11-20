import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, SRGBColorSpace } from "three";

/** Authored overlapping conifer scales and longitudinal needle grooves contain no broadleaf veins. */
export const createCatalogColumnarTextures = (juniper: boolean) => {
  const width = 64, height = 128;
  const colour = new Uint8Array(width * height * 4), normal = new Uint8Array(colour.length);
  const surface = (u: number, v: number) => {
    if (juniper) return .79 + Math.exp(-(((u - .5) / .13) ** 2)) * .17 +
      .025 * Math.sin(v * 151 + u * 9);
    const row = Math.floor(v * 13), phase = u * 5 + row * .5;
    const x = phase - Math.floor(phase) - .5, y = v * 13 - row;
    return .76 + Math.exp(-((x / .42) ** 4) - ((y - .42) / .65) ** 2) * .20;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height, index = (y * width + x) * 4;
    const shade = surface(u, v);
    colour[index] = shade * 255; colour[index + 1] = shade * 255;
    colour[index + 2] = shade * 245; colour[index + 3] = 255;
    const dx = (surface(u + 1 / width, v) - surface(u - 1 / width, v)) * 1.8;
    const dy = (surface(u, v + 1 / height) - surface(u, v - 1 / height)) * 1.8;
    const length = Math.hypot(dx, dy, 1);
    normal[index] = (-dx / length * .5 + .5) * 255;
    normal[index + 1] = (-dy / length * .5 + .5) * 255;
    normal[index + 2] = (1 / length * .5 + .5) * 255; normal[index + 3] = 255;
  }
  const map = new DataTexture(colour, width, height, RGBAFormat);
  const normalMap = new DataTexture(normal, width, height, RGBAFormat); map.colorSpace = SRGBColorSpace;
  for (const texture of [map, normalMap]) {
    texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.needsUpdate = true;
  }
  return { map, normalMap, dispose: () => { map.dispose(); normalMap.dispose(); } };
};
