import { Color, DataTexture, type Material, RGBAFormat, type Texture, UnsignedByteType } from "three";

export const STAND_IN_MAP_KEYS = [
  "alphaMap", "aoMap", "bumpMap", "emissiveMap", "map", "metalnessMap", "normalMap", "roughnessMap"
] as const;

export type StandInTextureKey = (typeof STAND_IN_MAP_KEYS)[number];
export type CopyTexture = (texture: Texture | null | undefined) => Texture | undefined;

/** A material texture slot. Three initialises missing map slots to null, not undefined. */
export const textureOf = (material: Material, key: StandInTextureKey) =>
  (material as unknown as Record<string, unknown>)[key] as Texture | null | undefined;

/** The source's albedo tint, whether a built-in material colour or a raw-shader uniform. */
export const colorOf = (material: Material) => {
  const color = (material as { color?: Color }).color;
  if (color?.isColor === true) return color.getHex();
  const uniforms = (material as { uniforms?: Record<string, { value?: unknown }> }).uniforms;
  const uniformColor = uniforms?.uColor?.value;
  if (uniformColor instanceof Color) return uniformColor.getHex();
  if (typeof uniformColor === "number") return uniformColor;
  const tint = uniforms?.uTint?.value;
  if (tint instanceof Color) return tint.getHex();
  if (typeof tint === "number") return tint;
  return undefined;
};

/** The CPU pixels the WebGL upload released, retained only while the WebGPU spike is active. */
export const retainedPixelsOf = (texture: Texture | null | undefined) => {
  const pixels = texture?.userData?.webgpuSourcePixels;
  return pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray ? pixels : undefined;
};

/** A node-renderer texture rebuilt from the retained WebGL surface pixels. */
export const copySourceTexture = (texture: Texture | null | undefined) => {
  const image = texture?.image as { data?: ArrayLike<number>; height?: number; width?: number } | undefined;
  if (texture == null || image?.width === undefined || image.height === undefined) return undefined;
  // The WebGL upload releases building-surface pixels; procedural DataTextures and small loaded
  // atlases (sails, signposts, sprites) keep theirs in the image instead.
  let pixels = retainedPixelsOf(texture) ?? (image.data instanceof Uint8Array ? image.data : undefined);
  if (pixels === undefined && typeof document !== "undefined" &&
    (image as { complete?: boolean }).complete !== false) {
    if (image.width * image.height > 1024 * 1024) return undefined;
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (context === null) return undefined;
    try { context.drawImage(image as unknown as CanvasImageSource, 0, 0); }
    catch { return undefined; }
    pixels = context.getImageData(0, 0, image.width, image.height).data;
  }
  if (pixels === undefined) return undefined;
  const copy = new DataTexture(pixels, image.width, image.height, RGBAFormat, UnsignedByteType);
  copy.anisotropy = texture.anisotropy;
  copy.colorSpace = texture.colorSpace;
  copy.flipY = texture.flipY;
  copy.generateMipmaps = texture.generateMipmaps;
  copy.magFilter = texture.magFilter;
  copy.minFilter = texture.minFilter;
  // World-space road UVs exceed 0..1 and construction sand repeats its texture; a copy without
  // the wrap mode or transform clamps/stretches them.
  copy.wrapS = texture.wrapS;
  copy.wrapT = texture.wrapT;
  copy.repeat.copy(texture.repeat);
  copy.offset.copy(texture.offset);
  copy.center.copy(texture.center);
  copy.rotation = texture.rotation;
  // C-3: bake the copied transform once. A default-uv texture node updates per object and
  // recomputed this matrix on every update; with auto update off it only re-binds the uniform.
  copy.matrixAutoUpdate = false;
  copy.updateMatrix();
  copy.name = `wg0:${texture.name || "surface"}`;
  copy.userData.wg0Copied = true;
  copy.needsUpdate = true;
  return copy;
};

/**
 * A late-loaded map (signpost icons, sail artwork) is a real texture the stand-in was not built
 * with. A missing map never counts as a late one, so a map-less tinted surface keeps its colour.
 */
export const needsStandInMapSync = (standIn: Material, source: Material) => {
  const sourceMap = textureOf(source, "map");
  return sourceMap != null && standIn.userData.wg4MapSource !== sourceMap;
};

interface StandInMaterial extends Material {
  [key: string]: unknown;
  color?: Color;
  emissive?: Color;
  emissiveIntensity?: number;
}

/**
 * Copies every lit map that arrived or changed after the stand-in was built (premium timber and
 * linen, sail artwork, pirate KTX2 atlases, signpost icons) and re-applies the source tint. A map
 * carries its own albedo unless the source has an explicit non-white tint, exactly as at build
 * time. Compressed maps whose pixels cannot be read stay on the stand-in unchanged.
 */
export const syncStandInMaps = (standIn: Material, source: Material, copyTexture: CopyTexture) => {
  const target = standIn as StandInMaterial;
  const maps = (standIn.userData.wg5MapSources ??= {}) as Partial<Record<StandInTextureKey, Texture>>;
  let changed = false;
  for (const key of STAND_IN_MAP_KEYS) {
    const sourceTexture = textureOf(source, key);
    if (sourceTexture == null || maps[key] === sourceTexture) continue;
    target[key] = copyTexture(sourceTexture) ?? sourceTexture;
    maps[key] = sourceTexture;
    changed = true;
  }
  if (!changed) return false;
  const tint = colorOf(source);
  target.color?.setHex(tint !== undefined && tint !== 0xffffff ? tint : 0xffffff);
  const sourceEmissive = (source as { emissive?: Color }).emissive;
  if (sourceEmissive !== undefined && target.emissive !== undefined) target.emissive.copy(sourceEmissive);
  target.emissiveIntensity = (source as { emissiveIntensity?: number }).emissiveIntensity ?? 1;
  standIn.userData.wg4MapSource = maps.map;
  standIn.needsUpdate = true;
  return true;
};
