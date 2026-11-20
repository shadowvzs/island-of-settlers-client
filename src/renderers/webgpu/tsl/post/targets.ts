import {
  ClampToEdgeWrapping,
  LinearFilter,
  NearestFilter,
  type RenderTarget,
  RenderTarget as RenderTargetClass,
  type TextureDataType
} from "three/webgpu";

/**
 * Render targets of the TSL frame post chain. Every target is sampled by a later fullscreen pass,
 * so its texture keeps clamp-to-edge wrapping and no mipmaps.
 */
export interface PostTargetOptions {
  /** Colour buffer type; the default half float keeps bloom radiance above 1. */
  type?: TextureDataType;
  /** Filtering of the sampled result (nearest for masked/analytic data, linear for images). */
  filter?: typeof LinearFilter | typeof NearestFilter;
  /** Channel layout; RGBA by default, RED (R32F) for analytic scalars. */
  format?: number;
}

export const createPostTarget = (width: number, height: number, options: PostTargetOptions = {}) => {
  const filter = options.filter ?? LinearFilter;
  const target = new RenderTargetClass(Math.max(1, width), Math.max(1, height), {
    depthBuffer: false,
    format: options.format as never,
    generateMipmaps: false,
    magFilter: filter,
    minFilter: filter,
    type: options.type
  });
  target.texture.wrapS = ClampToEdgeWrapping;
  target.texture.wrapT = ClampToEdgeWrapping;
  return target;
};

/** Resizes a target, keeping the one-texel floor of a tiny viewport. */
export const resizePostTarget = (target: RenderTarget, width: number, height: number) => {
  target.setSize(Math.max(1, width), Math.max(1, height));
};
