import { DataTexture, DoubleSide, Group, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, RepeatWrapping, RGBAFormat, SRGBColorSpace } from "three";

import type { FloweringSpecies } from "../../../render-common/plants/catalog-flowering-graph";
import { createCatalogPetalTexture } from "./catalog-flowering-petal-texture";
import { createCatalogFloweringSurfaces } from "./catalog-flowering-surfaces";
import { createMapleBarkMaterial } from "./maple-bark-material";
import { definePlantCompletionFamily } from "./plant-completion-contract";

export interface CatalogFloweringAsset {
  species: string;
  variant: number;
  form: "standalone" | "roadside";
  potted?: boolean;
}
export const CATALOG_FLOWERING_SPECIES: readonly FloweringSpecies[] = ["cherry-blossom", "white-cherry",
  "white-peach", "double-peach", "pink-peach", "red-maple"];
export const supportsCatalogFloweringAsset = (asset: CatalogFloweringAsset) => {
  if (asset.potted || !CATALOG_FLOWERING_SPECIES.includes(asset.species as FloweringSpecies)) return false;
  if (["pink-peach", "red-maple"].includes(asset.species)) return asset.form === "roadside";
  return true;
};
/** Original bilateral blade veins; shared once across the complete species material owner. */
const createFloweringLeafTexture = () => {
  const size = 128, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1), v = y / (size - 1), side = Math.abs(u - .5);
    const midrib = Math.exp(-Math.abs(u - .5) * 190);
    const veinPhase = (v - side * .72) * 9;
    const vein = Math.exp(-Math.abs(veinPhase - Math.round(veinPhase)) * 45) * (1 - side * 1.6);
    const grain = Math.sin(x * 2.7 + y * 1.3) * .012;
    const shade = Math.min(1, .86 + midrib * .12 + vein * .09 + grain);
    const i = (y * size + x) * 4;
    pixels[i] = Math.round(shade * 255); pixels[i + 1] = Math.round(shade * 255);
    pixels[i + 2] = Math.round(shade * 246); pixels[i + 3] = 255;
  }
  const map = new DataTexture(pixels, size, size, RGBAFormat);
  map.colorSpace = SRGBColorSpace; map.generateMipmaps = true;
  map.minFilter = LinearMipmapLinearFilter; map.needsUpdate = true;
  return map;
};

/** Cherry's warm smooth young bark carries horizontal lenticels rather than maple cork plates. */
const createCherryBark = () => {
  const width = 128, height = 256, pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const column = Math.floor(x / 16), row = Math.floor(y / 19);
    const stripeY = row * 19 + (column * 7) % 19;
    const lenticel = Math.abs(y - stripeY) < 1.5 && (x + row * 3) % 16 < 10;
    const shade = .83 + Math.sin(x * .22 + Math.sin(y * .033)) * .035 - (lenticel ? .23 : 0);
    const i = (y * width + x) * 4;
    pixels[i] = Math.round(shade * 255); pixels[i + 1] = Math.round(shade * 238);
    pixels[i + 2] = Math.round(shade * 220); pixels[i + 3] = 255;
  }
  const map = new DataTexture(pixels, width, height, RGBAFormat); map.colorSpace = SRGBColorSpace;
  map.wrapS = RepeatWrapping; map.wrapT = RepeatWrapping; map.repeat.y = .25;
  map.generateMipmaps = true; map.minFilter = LinearMipmapLinearFilter; map.needsUpdate = true;
  const material = new MeshStandardMaterial({ color: "#b58061", map, bumpMap: map,
    bumpScale: .006, roughness: .82, vertexColors: true });
  return { material, dispose: () => { material.dispose(); map.dispose(); } };
};

/** Pack owns shared maps/materials; every model owns and disposes its merged geometry. */
export const createCatalogFloweringPack = () => {
  const cherryBark = createCherryBark();
  const bark = createMapleBarkMaterial();
  bark.material.color.set("#c38c67");
  const leafMap = createFloweringLeafTexture();
  const leaves = new MeshStandardMaterial({ map: leafMap, bumpMap: leafMap, bumpScale: .002, color: "#ffffff", roughness: .83, side: DoubleSide,
    vertexColors: true });
  const petalMap = createCatalogPetalTexture();
  const petals = new MeshStandardMaterial({ map: petalMap, bumpMap: petalMap, bumpScale: .0008, color: "#ffffff", roughness: .70, side: DoubleSide,
    vertexColors: true });

  let disposed = false;
  const create = (asset: CatalogFloweringAsset, detailed: boolean, tier: "near" | "far" | "overview" = "near") => {
    if (disposed) throw new Error("Flowering pack is disposed");
    if (!supportsCatalogFloweringAsset(asset)) throw new Error("Unsupported flowering asset");
    if (![0, 1, 2].includes(asset.variant)) throw new Error("Unknown flowering variant");
    if (tier !== "near") throw new Error("Flowering far requires the canonical async overview owner");
    const fullDetail = detailed;
    const key = `${asset.species}:${asset.form}:${asset.variant}:${fullDetail}:${tier}`;
    const surfaces = createCatalogFloweringSurfaces(asset.species as FloweringSpecies, asset.variant,
      asset.form === "roadside", fullDetail);
    const root = new Group(); root.name = `catalog-flowering-${key}`;
    for (const [name, geometry, material] of [["bark", surfaces.bark, asset.species.includes("cherry") ? cherryBark.material : bark.material],
      ["foliage", surfaces.foliage, leaves], ["blossoms", surfaces.blossoms, petals]] as const) {
      if (!geometry.getAttribute("position").count) continue;
      const mesh = new Mesh(geometry, material); mesh.name = `flowering-${name}`;
      mesh.castShadow = detailed; mesh.receiveShadow = detailed; root.add(mesh);
    }
    let released = false;
    return { root, triangles: surfaces.triangles, dispose: () => {
      if (released) return;
      released = true; root.removeFromParent(); root.clear();
      surfaces.bark.dispose(); surfaces.foliage.dispose(); surfaces.blossoms.dispose();
    } };
  };
  return { create, materials: { bark: bark.material, cherryBark: cherryBark.material, leaves, petals }, dispose: () => {
    if (disposed) return;
    disposed = true;
    bark.dispose(); cherryBark.dispose(); leaves.dispose(); petals.dispose(); leafMap.dispose(); petalMap.dispose();
  } };
};

export const catalogFloweringFamily = definePlantCompletionFamily({
  id: "catalog-flowering",
  species: CATALOG_FLOWERING_SPECIES,
  createMaterials: () => createCatalogFloweringPack(),
  createModel: (pack, asset, detailed, tier) => pack.create(asset, detailed, tier)
});
