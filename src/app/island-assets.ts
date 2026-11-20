import { profileStep } from "../render-common/load-profile";
import { loadGroundVariantLayers } from "../render-common/materials/ground-variant-tiles";
import { MATERIAL_TILE_SIZE, packGroundLayers } from "../render-common/materials/material-textures";
import { loadMicroDetailAtlas } from "../render-common/materials/micro-detail-atlas";
import { loadBiomeGrassMeshPayload } from "../render-common/props/plants/biome-grass-mesh-loader";
import type { RendererChoice } from "../render-common/renderer-choice";
import type { RendererModule } from "../render-common/renderer-contract";
import type { PaintedTexture } from "../render-common/trees/atlas-canvas";
import { loadHardwoodMeshPayload } from "../render-common/trees/hardwood-mesh-loader";
import { loadAnimalModels } from "../render-common/wildlife/model/animal-asset-loader";
import { MATERIAL_COUNT } from "../shared/world/world-data";
import { MATERIAL_SEED, ROCK_SEED } from "./asset-seeds";
import type { WorkerPool } from "./worker-pool";

/** Loading workers: world, textures and the content builds (rocks, terrain, bakes) in parallel. */
const MAX_WORKERS = 12;

export const workerPoolSize = () => Math.max(2, Math.min(MAX_WORKERS, navigator.hardwareConcurrency || 4));

/** The renderer is its own lazy chunk: it downloads and parses while the island generates. */
export const loadRenderer = async (choice: RendererChoice = "webgl"): Promise<RendererModule> => {
  if (choice === "webgl") return (await import("../renderers/three/create-three-renderer")).rendererModule;
  return (await import("../renderers/three/create-three-webgpu-renderer")).rendererModule;
};

/**
 * Everything the renderer needs that does not depend on the island (shared by every world). The
 * hardwood and biome-grass payloads are installed on this thread for the prop meshes; workers fetch
 * their own copies.
 */
export const loadIslandAssets = async (pool: WorkerPool, foliage: Promise<PaintedTexture>) => {
  const [animalModels, flyerAtlas, foliageAtlas, microDetail, rockTexture, layers, variants] = await Promise.all([
    loadAnimalModels(),
    pool.generateFlyerAtlas(),
    foliage,
    loadMicroDetailAtlas(),
    pool.generateRock(ROCK_SEED),
    Promise.all(
      Array.from({ length: MATERIAL_COUNT }, (_, material) =>
        pool.generateMaterial(material, MATERIAL_TILE_SIZE, MATERIAL_SEED)
      )
    ),
    loadGroundVariantLayers(MATERIAL_TILE_SIZE),
    Promise.all([loadHardwoodMeshPayload(), loadBiomeGrassMeshPayload()])
  ]);
  const materials = profileStep("pack ground layers", () => packGroundLayers([...layers, ...variants]));
  return { animalModels, flyerAtlas, foliageAtlas, materials, microDetail, rockTexture };
};
export type IslandAssets = Awaited<ReturnType<typeof loadIslandAssets>>;
