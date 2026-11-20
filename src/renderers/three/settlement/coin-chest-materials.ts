import { DataTexture, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial, RepeatWrapping, RGBAFormat, SRGBColorSpace } from "three";

/** Original straight-grained oak: no shared global map and no cross-board oversized knot. */
const createCoinEdgeTexture = () => {
  const data = new Uint8Array(16 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 16; x++) {
    const seam = Math.exp(-((Math.min(y, 31 - y) / 2) ** 2));
    const shade = Math.round(255 * (.95 - .26 * seam + .025 * Math.sin(x * 1.7)));
    const offset = (y * 16 + x) * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = shade; data[offset + 3] = 255;
  }
  const texture = new DataTexture(data, 16, 32, RGBAFormat);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace; texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter; texture.generateMipmaps = true; texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
};

export const createCoinChestMaterials = (detailed: boolean, contents = true) => {
  const width = detailed ? 128 : 64, height = width * 2;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const grain = Math.sin(x * .53 + Math.sin(y * .033) * .75) * .035 +
      Math.sin(x * 2.31 + Math.sin(y * .061) * .4) * .010;
    const pores = Math.sin(x * 11.3 + y * .19) * .004;
    const shade = .84 + grain + pores;
    const offset = (y * width + x) * 4;
    data[offset] = Math.round(167 * shade);
    data[offset + 1] = Math.round(115 * shade);
    data[offset + 2] = Math.round(65 * shade);
    data[offset + 3] = 255;
  }
  const texture = new DataTexture(data, width, height, RGBAFormat);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace; texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter; texture.generateMipmaps = true; texture.anisotropy = 4;
  texture.needsUpdate = true;
  const wood = new MeshStandardMaterial({ color: "#e5d0ae", map: texture,
    bumpMap: detailed ? texture : null, bumpScale: .00045, roughness: .77, vertexColors: true });
  const iron = new MeshStandardMaterial({ color: "#484840", metalness: .72, roughness: .53, vertexColors: true });
  const coinEdge = contents ? createCoinEdgeTexture() : null;
  const gold = new MeshStandardMaterial({ color: "#cba443", map: coinEdge,
    bumpMap: detailed ? coinEdge : null, bumpScale: .00022,
    metalness: .8, roughness: .36, vertexColors: true });
  let disposed = false;
  return { gold, iron, wood, dispose: () => {
    if (disposed) return;
    disposed = true;
    texture.dispose(); coinEdge?.dispose(); wood.dispose(); iron.dispose(); gold.dispose();
  } };
};
