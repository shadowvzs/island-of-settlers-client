import {
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  RGBAFormat
} from "three";

import { SKY_VIEW_LUT_HEIGHT, SKY_VIEW_LUT_WIDTH } from "../../render-common/atmosphere/sky-view-lut";
import type { SkyLight } from "../../render-common/lighting/sky-irradiance";

/**
 * The sky-view LUT as a small half-float texture (R06b, Medium+ skies): refilled from the shared
 * sky light's CPU table only when its revision changes (16 KiB upload).
 */
export const createSkyViewTexture = () => {
  const pixels = new Uint16Array(SKY_VIEW_LUT_WIDTH * SKY_VIEW_LUT_HEIGHT * 4);
  const texture = new DataTexture(pixels, SKY_VIEW_LUT_WIDTH, SKY_VIEW_LUT_HEIGHT, RGBAFormat,
    HalfFloatType);
  texture.colorSpace = LinearSRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.name = "sky-view-lut";
  let revision = -1;
  const update = (light: SkyLight) => {
    if (light.revision === revision) return;
    revision = light.revision;
    for (let index = 0; index < pixels.length; index++)
      pixels[index] = DataUtils.toHalfFloat(light.skyView[index]!);
    texture.needsUpdate = true;
  };
  return { texture, update };
};
