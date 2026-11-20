import { DepthTexture, FloatType, NearestFilter, type Texture } from "three/webgpu";

/**
 * C-1: the node renderer's twin of the WebGL sun shadow depth atlas (three-shadows.ts). The WebGL
 * `uShadowMap` texture is the key: the receivers sample its twin and the presenter's sun shadow
 * pass draws into it, so both sides find the same texture whichever is built first. Depth is
 * 32-bit float (the WebGL atlas is a 24-bit unsigned depth).
 */
const atlases = new WeakMap<Texture, DepthTexture>();

const sizeOf = (source: Texture) => {
  const image = source.image as { height?: number; width?: number } | undefined;
  return { height: Math.max(1, image?.height ?? 1), width: Math.max(1, image?.width ?? 1) };
};

export const sunShadowAtlasOf = (source: Texture): DepthTexture => {
  const known = atlases.get(source);
  if (known !== undefined) return known;
  const { height, width } = sizeOf(source);
  const atlas = new DepthTexture(width, height, FloatType);
  atlas.magFilter = NearestFilter;
  atlas.minFilter = NearestFilter;
  atlas.name = "wg:sun-shadow-atlas";
  atlases.set(source, atlas);
  return atlas;
};
