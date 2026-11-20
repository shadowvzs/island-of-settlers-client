import { Data3DTexture, DataTexture, LinearFilter, RGBAFormat, UnsignedByteType } from "three/webgpu";

/**
 * One-pixel stand-ins for uniforms whose owner may not have a texture yet (the lunar albedo
 * loads asynchronously, the cloud volume exists only on Medium+). Shared and never disposed: the
 * WebGPU module itself is a lazily loaded chunk, so this costs nothing on the WebGL path.
 */
const createPixelTexture = () => {
  const texture = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  texture.name = "sky-fallback-2d";
  return texture;
};

const createVoxelTexture = () => {
  const texture = new Data3DTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, 1);
  texture.format = RGBAFormat;
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  texture.name = "sky-fallback-3d";
  return texture;
};

export const SKY_FALLBACK_TEXTURE = createPixelTexture();
export const SKY_FALLBACK_VOLUME = createVoxelTexture();
