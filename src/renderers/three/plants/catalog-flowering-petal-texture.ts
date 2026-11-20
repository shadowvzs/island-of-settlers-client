import { DataTexture, LinearMipmapLinearFilter, RGBAFormat, SRGBColorSpace } from "three";

/** Original petal tissue: fine longitudinal capillaries and a soft basal pigment gradient. */
export const createCatalogPetalTexture = () => {
  const size = 128, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1), v = y / (size - 1);
    const warped = (u - .5) / (.24 + v * .76);
    const vein = Math.abs(Math.sin(warped * Math.PI * 13 + Math.sin(v * 8) * .12));
    const fine = Math.sin(x * 2.31 + y * 1.73) * .008;
    const pigment = Math.exp(-v * 4) * .12;
    const shade = .97 - pigment - Math.exp(-vein * 35) * .045 + fine;
    const at = (y * size + x) * 4;
    pixels[at] = Math.round(shade * 255); pixels[at + 1] = Math.round(shade * 252);
    pixels[at + 2] = Math.round(shade * 251); pixels[at + 3] = 255;
  }
  const map = new DataTexture(pixels, size, size, RGBAFormat); map.colorSpace = SRGBColorSpace;
  map.generateMipmaps = true; map.minFilter = LinearMipmapLinearFilter; map.needsUpdate = true;
  return map;
};
