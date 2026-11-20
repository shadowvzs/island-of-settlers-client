import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
  type Texture,
  UnsignedByteType
} from "three";

import {
  downsampleGroundLayers,
  type GroundLayerSet
} from "../../render-common/materials/material-textures";

/** The ground's two texture arrays: albedo + height, normal x/z + AO + roughness. */
export interface GroundLayerTextures {
  albedo: Texture;
  normal: Texture;
}

const GROUND_ANISOTROPY = 8;

/** One RGBA8 texture array: hardware repeat, GPU-built mips per layer, trilinear + anisotropic. */
const createLayerArrayTexture = (pixels: Uint8Array, size: number, layerCount: number) => {
  const texture = new DataArrayTexture(pixels, size, size, layerCount);
  texture.format = RGBAFormat;
  texture.type = UnsignedByteType;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = GROUND_ANISOTROPY;
  texture.generateMipmaps = true;
  texture.premultiplyAlpha = false;
  texture.flipY = false;
  texture.unpackAlignment = 4;
  texture.needsUpdate = true;
  return texture;
};

/**
 * The ground layer textures at the preset's tile tier (QualityPreset.groundTileSize; a smaller tier
 * uploads the painted tiles' lower mip levels). This is the single place that turns a layer source
 * into GPU textures: an offline-baked KTX2 set (R14b, TOOL-2) would return its CompressedArrayTexture
 * pair here (three's KTX2Loader yields one; the client already loads KTX2 worker textures), with the
 * same layer order, and the ground shaders stay unchanged.
 */
export const createGroundLayerTextures = (set: GroundLayerSet, tileSize: number): GroundLayerTextures => {
  const tier = downsampleGroundLayers(set, tileSize);
  return {
    albedo: createLayerArrayTexture(tier.albedoHeight, tier.size, tier.layerCount),
    normal: createLayerArrayTexture(tier.normalRoughness, tier.size, tier.layerCount)
  };
};
