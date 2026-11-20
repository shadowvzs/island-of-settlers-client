import { DataTexture, LinearFilter, LinearMipmapLinearFilter, type MeshStandardMaterial,
  RepeatWrapping, SRGBColorSpace } from "three";

import { STONE_MATERIAL_WARES } from "../../render-common/wares/advanced-material-variants";
import { ownBuildingMaterial } from "./buildings/building-material-ownership";
import { paintSurfacePixels } from "./buildings/building-surface-pixels";
import { roadStoneSurface, type StoneSurfaceFamily } from "./road-decoration-stone-samples";

const cached = new Map<string, { maps: DataTexture[]; users: number }>();

/** Private per-template maps. Material ownership frees them once and never disposes the borrowed pack. */
/**
 * Base colour of a family's dressed faces. Granite keeps a neutral matrix (its warm quarry family
 * contributes feldspar only); warm granite shows that quarry colour; basalt uses its lighter seam grey
 * so the near-black rock still reads at gameplay distance.
 */
const stoneBase = (family: StoneSurfaceFamily): readonly number[] => {
  if (family === "warm-granite") return STONE_MATERIAL_WARES.granite.body;
  if (family === "basalt") return STONE_MATERIAL_WARES.basalt.seam;
  const appearance = STONE_MATERIAL_WARES[family];
  if (family !== "granite") return appearance.body;
  const neutral = appearance.body.reduce((sum, value) => sum + value, 0) / 3 * 1.35;
  return [neutral * .98, neutral, neutral * 1.015];
};

export const createRoadDecorationStoneMaterial = (source: MeshStandardMaterial, detailed: boolean,
  family: StoneSurfaceFamily = "limestone") => {
  const resolution = detailed ? 256 : 128;
  const key = `${family}:${resolution}`;
  let entry = cached.get(key);
  if (!entry) {
    const base = stoneBase(family).map(value => value * 255) as [number, number, number];
    const maps = paintSurfacePixels(roadStoneSurface(family), base, resolution, detailed).map((pixels, index) => {
    const texture = new DataTexture(pixels, resolution, resolution);
    texture.wrapS = texture.wrapT = RepeatWrapping; texture.flipY = true;
    texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.anisotropy = 8;
    if (index === 0) texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    texture.addEventListener("dispose", () => { texture.image.data = null; });
    return texture;
    });
    entry = { maps, users: 0 }; cached.set(key, entry);
  }
  entry.users++;
  const { maps } = entry;
  const material = source.clone();
  material.map = maps[0]!; material.normalMap = maps[1] ?? null; material.roughnessMap = maps[2] ?? null;
  material.color.setRGB(1, 1, 1);
  material.normalScale.set(family === "marble" ? .7 : 2.8, family === "marble" ? .7 : 2.8);
  material.roughness = 1; material.metalness = 0;
  ownBuildingMaterial(material, source, true);
  const release = () => {
    material.removeEventListener("dispose", release);
    if (--entry.users === 0) cached.delete(key);
  };
  material.addEventListener("dispose", release);
  return material;
};
