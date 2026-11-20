import type { WorldData } from "../shared/world/world-data";
import type { BakedSprites } from "./baker/prop-baker";
import type { BakedTreeViews } from "./baker/tree-view-baker";
import type { TreeViewSource } from "./baker/tree-view-layout";
import type { BuildingSurface } from "./buildings/building-recipe";
import type { SurfaceMode } from "./chunk-sampling";
import type { CoverField } from "./props/cover-field";
import type { PropMesh } from "./props/mesh-builder";
import type { PropInstances } from "./props/prop-instances";
import type { IslandRocks } from "./rocks/island-rocks";
import type { RockSkinDetail } from "./rocks/rock-skin";
import { buildChunk, type ChunkVertexData,listChunksFarToNear } from "./terrain-chunks";
import type { WaterField } from "./water-field";
import type { WorkerNation } from "./workers/worker-unit";

/** Leaf atlas pixels the sprite baker samples (square RGBA). */
export interface BakeLeafAtlas {
  /** Source normal map for per-leaf relief in the sprite normal pass. */
  normalPixels?: Uint8Array;
  pixels: Uint8Array;
  size: number;
}

/**
 * The heavy, renderer independent CPU builds of the island. The app runs them in its worker
 * pool, in parallel and off the main thread; a renderer starts the ones it needs first, builds
 * its GPU objects meanwhile, then awaits them.
 */
export interface ContentBuilders {
  /**
   * Prop meshes rendered into a sprite atlas (WebGL2 on an OffscreenCanvas); `name` names the
   * mesh set (cache key, load profile): the same name must always mean the same meshes.
   */
  bakeSprites: (
    name: string,
    meshes: PropMesh[],
    leafAtlas: BakeLeafAtlas
  ) => Promise<BakedSprites>;
  /**
   * R15a: hemispherical view blocks of the island's tree meshes (possessed far trees). Uncached:
   * a quick GPU bake, requested only when the possessed view first needs it. `budgetBytes` is
   * the preset's atlas memory budget.
   */
  bakeTreeViews: (
    meshes: PropMesh[],
    sources: TreeViewSource[],
    leafAtlas: BakeLeafAtlas,
    budgetBytes: number
  ) => Promise<BakedTreeViews>;
  coverField: () => Promise<CoverField>;
  fieldCover: (samplesPerCell: number) => Promise<PropInstances>;
  /** Spring meadow flowers (spring-flowers.ts), requested once a spring look first shows; optional for tools. */
  springFlowers?: (samplesPerCell: number) => Promise<PropInstances>;
  islandRocks: (detail?: RockSkinDetail) => Promise<IslandRocks>;
  /** RGBA maps of one building surface (albedo, then normal and roughness when detailed). */
  paintBuildingSurface: (paint: BuildingSurfacePaint) => Promise<Uint8ClampedArray<ArrayBuffer>[]>;
  /** Every prop mesh of the seed (createPropMeshes): island independent, cached as shared. */
  propMeshes: (seed: number) => Promise<PropMesh[]>;
  /** Terrain chunks far to near (water chunks without a wet quad are left out). */
  terrainChunks: (mode: SurfaceMode) => Promise<ChunkVertexData[]>;
  waterField: () => Promise<WaterField>;
}

/**
 * The terrain chunks of one surface, far to near; `part` of `parts` is one contiguous run of
 * that order, so the parts built by several workers join back in order.
 */
export const buildTerrainChunks = (
  world: WorldData,
  fog: Float32Array,
  mode: SurfaceMode,
  part = 0,
  parts = 1
) => {
  const order = listChunksFarToNear(world);
  const from = Math.floor((order.length * part) / parts);
  const to = Math.floor((order.length * (part + 1)) / parts);
  return order.slice(from, to).flatMap(({ chunkX, chunkZ }) => {
    const data = buildChunk(world, fog, chunkX, chunkZ, mode);
    return data ? [data] : [];
  });
};

/**
 * One procedural building surface to paint: the Roman base pack (`nation` "roman") or a nation's
 * own wall or roof surface, at a map size; `detailed` adds the normal and roughness maps.
 */
export interface BuildingSurfacePaint {
  detailed: boolean;
  nation: WorkerNation;
  resolution: number;
  surface: BuildingSurface;
}

/** The builders that do not need the world (prefetched while the island is generated). */
export type SharedContentBuilders = Pick<
  ContentBuilders,
  "bakeSprites" | "paintBuildingSurface" | "propMeshes"
>;
