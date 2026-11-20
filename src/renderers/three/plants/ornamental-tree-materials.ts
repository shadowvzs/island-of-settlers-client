import {
  type ColorRepresentation,
  DataTexture, MeshStandardMaterial, RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType} from "three";

import { ornamentalNoise } from "../../../render-common/plants/ornamental-tree-graph";

interface OrnamentalMaterialColours {
  bark?: ColorRepresentation;
  ceramic?: ColorRepresentation;
  foliage?: ColorRepresentation;
  soil?: ColorRepresentation;
}

/** One owned bark map is shared by every woody batch; no canvas or per-instance texture. */
const createOrnamentalBarkTexture = () => {
  const width = 128, height = 256, pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width * Math.PI * 2, v = y / height * Math.PI * 2;
    const fissure = Math.abs(Math.sin(u * 11 + .23 * Math.sin(v * 3 + u * 2)));
    const ridges = .035 * Math.sin(u * 29 + .3 * Math.sin(v * 7));
    const pores = ornamentalNoise(x * 13 + y * 171) * .055;
    const interrupted = .35 + .65 * (Math.sin(v * 13 + u * 7) * .5 + .5);
    const acrossPlate = Math.abs(Math.sin(v * 11 + Math.sin(u * 3) * .6));
    const shortCracks = Math.exp(-acrossPlate * 32) * Math.exp(-Math.abs(Math.sin(u * 5 + v * .7)) * 3);
    const shade = Math.max(.43, .78 + ridges + pores - Math.exp(-fissure * 28) * .22 * interrupted
      - shortCracks * .14);
    const index = (y * width + x) * 4;
    pixels[index] = Math.round(255 * shade);
    pixels[index + 1] = Math.round(248 * shade);
    pixels[index + 2] = Math.round(234 * shade);
    pixels[index + 3] = 255;
  }
  const texture = new DataTexture(pixels, width, height, RGBAFormat, UnsignedByteType);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping; texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
};

/** The template owner disposes these; models and cloned instances only borrow them. */
export const createOrnamentalTreeMaterials = (colours: OrnamentalMaterialColours = {}) => {
  const texture = createOrnamentalBarkTexture();
  const materials = {
    bark: new MeshStandardMaterial({ color: colours.bark ?? "#897263", roughness: .96,
      vertexColors: true, map: texture, bumpMap: texture, bumpScale: .003 }),
    ceramic: new MeshStandardMaterial({ color: colours.ceramic ?? "#344d48", roughness: .43,
      metalness: .02, vertexColors: true }),
    foliage: new MeshStandardMaterial({ color: colours.foliage ?? "#355c3a", roughness: .79,
      vertexColors: true }),
    soil: new MeshStandardMaterial({ color: colours.soil ?? "#514333", roughness: 1, vertexColors: true })
  };
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    Object.values(materials).forEach(material => material.dispose());
    texture.dispose();
  };
  return { materials, dispose };
};
