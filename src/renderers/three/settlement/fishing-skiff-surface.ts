import { DataTexture, DoubleSide, MeshStandardMaterial, RepeatWrapping, RGBAFormat, SRGBColorSpace } from "three";

/** Neutral longitudinal grain multiplies the national plank colours on both carried and water hulls. */
export const createFishingSkiffSurface = () => {
  const width = 128, height = 128, pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const warp = Math.sin(x * .10 + Math.sin(y * .045) * .8) * 1.5;
    const lines = Math.sin(y * .39 + warp) * 13 + Math.sin(y * 1.03 + warp * 2) * 5;
    const knots = Math.sin(x * .17 + y * .08) * Math.sin(y * .27) * 5;
    const value = Math.max(0, Math.min(255, Math.round(226 + lines + knots)));
    const at = (y * width + x) * 4;
    pixels.set([value, value, Math.max(0, value - 3), 255], at);
  }
  const texture = new DataTexture(pixels, width, height, RGBAFormat);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  const material = new MeshStandardMaterial({ map: texture, roughness: .88, side: DoubleSide, vertexColors: true });
  return { material, texture, dispose: () => { material.dispose(); texture.dispose(); } };
};
