import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace } from "three";

const paint = (soil: boolean) => {
  const size = 128, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const grain = Math.sin(x * 79.13 + y * 167.71) * 43758.5453;
    const speck = grain - Math.floor(grain);
    let shade = .89 + .035 * Math.sin(v * 281 + Math.sin(u * 19) * .3) + (speck - .5) * .055;
    if (soil) {
      const clods = Math.sin(u * 89 + Math.sin(v * 61) * 2) * Math.sin(v * 103 + Math.sin(u * 53));
      shade = .71 + clods * .16 + speck * .19;
      if (speck > .97) shade += .09;
    }
    const index = (y * size + x) * 4;
    pixels[index] = shade * 255; pixels[index + 1] = shade * 251;
    pixels[index + 2] = shade * (soil ? 233 : 255); pixels[index + 3] = 255;
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat); texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = true; texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter;
  texture.wrapS = RepeatWrapping; texture.wrapT = RepeatWrapping; texture.needsUpdate = true;
  return texture;
};

/** Original wheel-thrown glaze grain and granular root substrate; one shared pair per potted material owner. */
export const createCatalogColumnarPotTextures = () => {
  const ceramic = paint(false), soil = paint(true);
  return { ceramic, soil, dispose: () => { ceramic.dispose(); soil.dispose(); } };
};
