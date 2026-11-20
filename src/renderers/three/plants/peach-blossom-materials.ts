import {
  type ColorRepresentation, DataTexture, DoubleSide, LinearFilter,
  LinearMipmapLinearFilter, MeshStandardMaterial, RGBAFormat, SRGBColorSpace
} from "three";

/** Original subtle silk-like petal striations; neutral pixels permit pink/white palette reuse. */
export const createPeachPetalTextures = () => {
  const size = 128, colour = new Uint8Array(size * size * 4), normals = new Uint8Array(colour.length);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1), v = y / (size - 1), at = (y * size + x) * 4;
    const flow = (u - .5) / (.20 + v * .8), phase = flow * 37 + Math.sin(v * 7) * .7;
    const vein = Math.sin(phase) ** 12 * .035 * Math.sin(Math.PI * v);
    const grain = Math.sin(x * 1.71 + y * 2.13) * Math.sin(x * .73 - y * .91) * .012;
    const shade = Math.round(Math.max(0, Math.min(1, .95 - vein + grain)) * 255);
    colour[at] = shade; colour[at + 1] = shade; colour[at + 2] = shade; colour[at + 3] = 255;
    normals[at] = Math.round(128 + Math.cos(phase) * 10 * Math.sin(Math.PI * v));
    normals[at + 1] = Math.round(128 + Math.cos(v * 17 + u * 2) * 3);
    normals[at + 2] = 254; normals[at + 3] = 255;
  }
  const map = new DataTexture(colour, size, size, RGBAFormat);
  const normalMap = new DataTexture(normals, size, size, RGBAFormat);
  map.colorSpace = SRGBColorSpace;
  for (const texture of [map, normalMap]) {
    texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.needsUpdate = true;
  }
  let disposed = false;
  return { map, normalMap, dispose: () => {
    if (disposed) return;
    disposed = true;
    for (const texture of [map, normalMap]) { texture.dispose(); texture.image.data = null; }
  } };
};

export type PeachPetalTextures = ReturnType<typeof createPeachPetalTextures>;

/** Geometry and texture packs are shareable; a palette owns materials, never a borrowed texture pack. */
export const createPeachBlossomMaterials = (colour: ColorRepresentation = "#f9b7ca",
  borrowedTextures?: PeachPetalTextures) => {
  const textures = borrowedTextures ?? createPeachPetalTextures();
  const petals = new MeshStandardMaterial({ color: colour, map: textures.map, normalMap: textures.normalMap,
    roughness: .72, side: DoubleSide, vertexColors: true });
  petals.normalScale.set(.30, .30);
  const calyx = new MeshStandardMaterial({ color: "#7b853e", roughness: .86,
    side: DoubleSide, vertexColors: true });
  const centre = new MeshStandardMaterial({ color: "#ffffff", roughness: .72,
    side: DoubleSide, vertexColors: true });
  const materials = { petals, calyx, centre };
  let disposed = false;
  return { materials, textures, dispose: () => {
    if (disposed) return;
    disposed = true; Object.values(materials).forEach(material => material.dispose());
    if (!borrowedTextures) textures.dispose();
  } };
};

export type PeachBlossomMaterials = ReturnType<typeof createPeachBlossomMaterials>["materials"];
