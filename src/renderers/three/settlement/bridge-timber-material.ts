import { DataTexture, LinearFilter, LinearMipmapLinearFilter, type MeshStandardMaterial,
  RepeatWrapping, SRGBColorSpace } from "three";

import { ownBuildingMaterial } from "../buildings/building-material-ownership";
import { paintSurfacePixels } from "../buildings/building-surface-pixels";
import { BRIDGE_TIMBER_BASE, type BridgeTierTimber, bridgeTimberSampler } from "./bridge-timber-samplers";

const cached = new Map<string, { maps: DataTexture[]; users: number }>();

const createMaps = (tier: BridgeTierTimber, boards: boolean, resolution: number, detailed: boolean) =>
  paintSurfacePixels(bridgeTimberSampler(tier, boards), BRIDGE_TIMBER_BASE[tier], resolution, detailed)
    .map((pixels, index) => {
      const texture = new DataTexture(pixels, resolution, resolution);
      texture.wrapS = texture.wrapT = RepeatWrapping; texture.flipY = true;
      texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter;
      texture.generateMipmaps = true; texture.anisotropy = 8;
      if (index === 0) texture.colorSpace = SRGBColorSpace;
      texture.needsUpdate = true;
      texture.addEventListener("dispose", () => { texture.image.data = null; });
      return texture;
    });

/**
 * The tier timber of a wooden bridge level (hardwood, cedar, walnut, mahogany): original painted
 * albedo, and on High its normal and roughness maps. Maps are shared per tier, surface and LOD and
 * freed with the last bridge that uses them; Minimal keeps the albedo only (one 128² map).
 */
export const createBridgeTimberMaterial = (
  source: MeshStandardMaterial, detailed: boolean, tier: BridgeTierTimber, boards: boolean
) => {
  const resolution = detailed ? 256 : 128;
  const key = `${tier}:${boards ? "planks" : "wood"}:${resolution}`;
  let entry = cached.get(key);
  if (!entry) {
    entry = { maps: createMaps(tier, boards, resolution, detailed), users: 0 };
    cached.set(key, entry);
  }
  entry.users++;
  const { maps } = entry;
  const material = source.clone();
  material.map = maps[0]!; material.normalMap = maps[1] ?? null; material.roughnessMap = maps[2] ?? null;
  material.color.setRGB(1, 1, 1);
  material.normalScale.set(boards ? .9 : .7, boards ? .9 : .7);
  material.roughness = 1; material.metalness = 0;
  ownBuildingMaterial(material, source, true);
  const release = () => {
    material.removeEventListener("dispose", release);
    if (--entry.users === 0) cached.delete(key);
  };
  material.addEventListener("dispose", release);
  return material;
};
