import {
  DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, SRGBColorSpace,
  UnsignedByteType
} from "three";

const veinHeight = (u: number, v: number) => {
  const distance = Math.abs(u - .5);
  const midrib = Math.exp(-((distance / .018) ** 2)) * .65;
  let lateral = 0;
  for (let rib = 1; rib < 11; rib++) {
    const anchor = rib / 12;
    const slope = .44 + Math.sin(rib * 1.71) * .07;
    const trace = Math.abs(v - anchor - distance * slope);
    lateral += Math.exp(-((trace / .005) ** 2)) * .23;
  }
  const cells = .025 * Math.sin(u * 179 + Math.sin(v * 83)) * Math.sin(v * 227);
  return midrib + lateral + cells;
};

/** Original neutral leaf lamina: one shared map/normal pair, no reference-image pixels. */
export const createOrnamentalLeafTextures = () => {
  const width = 128, height = 256;
  const colour = new Uint8Array(width * height * 4), normal = new Uint8Array(colour.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / (width - 1), v = y / (height - 1), at = (y * width + x) * 4;
    const heightValue = veinHeight(u, v);
    const shade = .76 + heightValue * .20 + .035 * Math.sin(v * 35 + u * 8);
    for (let channel = 0; channel < 3; channel++)
      colour[at + channel] = Math.round(Math.min(1, shade) * 255);
    colour[at + 3] = 255;
    const dx = (veinHeight(u + 1 / width, v) - veinHeight(u - 1 / width, v)) * 1.7;
    const dy = (veinHeight(u, v + 1 / height) - veinHeight(u, v - 1 / height)) * 1.7;
    const length = Math.hypot(dx, dy, 1);
    normal[at] = Math.round((-.5 * dx / length + .5) * 255);
    normal[at + 1] = Math.round((-.5 * dy / length + .5) * 255);
    normal[at + 2] = Math.round((.5 / length + .5) * 255);
    normal[at + 3] = 255;
  }
  const map = new DataTexture(colour, width, height, RGBAFormat, UnsignedByteType);
  map.colorSpace = SRGBColorSpace;
  const normalMap = new DataTexture(normal, width, height, RGBAFormat, UnsignedByteType);
  for (const texture of [map, normalMap]) {
    texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.needsUpdate = true;
  }
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; map.dispose(); normalMap.dispose();
  };
  return { map, normalMap, dispose };
};
