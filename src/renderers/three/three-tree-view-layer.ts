import { DataTexture, type IUniform, NearestFilter, RGFormat, UnsignedByteType } from "three";

import type { BakedTreeViews } from "../../render-common/baker/tree-view-baker";
import { FOLIAGE, getMeshFoliage, type TreeViewSource } from "../../render-common/baker/tree-view-layout";
import type { BakeLeafAtlas, ContentBuilders } from "../../render-common/content-builders";
import { getMatureMeshId } from "../../render-common/growth/stage-meshes";
import type { PropMesh } from "../../render-common/props/mesh-builder";
import type { PropInstances } from "../../render-common/props/prop-instances";
import type { LayerWarmup } from "./impostor-warmup";
import { createDeferredLayer } from "./three-deferred-impostors";
import { createAtlasTexture } from "./three-materials";
import { hasWinter } from "./three-prop-materials";
import { createTreeViews, listTreeViewInstances } from "./three-tree-views";
import { reportTreeViewStats } from "./tree-view-mode";

/**
 * Meshes the static trees can show: each world variant and the mature variant it grows into
 * (growth swaps a static tree to that id). Broadleaf meshes also get a bare winter block on
 * islands with snow.
 */
export const listTreeViewSources = (
  instances: PropInstances,
  meshes: readonly PropMesh[],
  winter: boolean
): TreeViewSource[] => {
  const meshIds = new Set<number>();
  for (const index of listTreeViewInstances(instances)) {
    const meshId = instances.meshIds[index]!;
    meshIds.add(meshId);
    meshIds.add(getMatureMeshId(meshId));
  }
  const sorted = [...meshIds].filter(meshId => meshes[meshId]).sort((first, second) => first - second);
  const sources = sorted.map(meshId => ({ bare: false, meshId }));
  if (!winter) return sources;
  const bare = sorted.filter(meshId => getMeshFoliage(meshes[meshId]!) === FOLIAGE.broadleaf);
  return [...sources, ...bare.map(meshId => ({ bare: true, meshId }))];
};

/** Plant-only copy of the impostor chunk mask: the iso sprites keep the plants, not the trees. */
const createPlantMask = (chunksX: number, chunksZ: number) => {
  const pixels = new Uint8Array(chunksX * chunksZ * 2);
  const texture = new DataTexture(pixels, chunksX, chunksZ, RGFormat, UnsignedByteType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  const copyPlants = (source: Uint8Array) => {
    for (let index = 1; index < pixels.length; index += 2) pixels[index] = source[index]!;
    texture.needsUpdate = true;
  };
  return { copyPlants, texture };
};

const sumBytes = (mips: readonly { data: Uint8Array }[]) => mips.reduce((sum, mip) => sum + mip.data.byteLength, 0);

const reportBaked = (baked: BakedTreeViews, instances: number, startedAt: number) => reportTreeViewStats({
  atlasHeight: baked.height,
  atlasWidth: baked.width,
  blocks: baked.layout.entries.length,
  bytes: sumBytes(baked.albedoMips) + sumBytes(baked.normalMips),
  instances,
  readyMs: performance.now() - startedAt,
  texelsPerUnit: baked.layout.texelsPerUnit
});

export interface TreeViewLayerOptions {
  /** Atlas memory budget of the preset (bytes): both maps with their mips. */
  budgetBytes: number;
  builders: Pick<ContentBuilders, "bakeTreeViews">;
  chunksX: number;
  chunksZ: number;
  /** High: blend the two nearest elevation rows too (four views); Medium blends azimuths only. */
  elevationBlend: boolean;
  isPresent: (sourceIndex: number) => boolean;
  leafAtlas: BakeLeafAtlas;
  meshes: readonly PropMesh[];
  warmup?: LayerWarmup;
}

/**
 * R15a possessed far trees. The bake starts with the first possessed frame (`start`), so an
 * isometric-only session pays neither the bake nor the atlas memory; until the layer is resident
 * the iso sprites keep drawing the far trees.
 */
export const createTreeViewLayer = (
  instances: PropInstances,
  uniforms: Record<string, IUniform>,
  options: TreeViewLayerOptions
) => {
  let start = () => {};
  let startedAt = 0;
  const started = new Promise<void>(resolve => {
    start = () => {
      startedAt ||= performance.now();
      resolve();
    };
  });
  const bake = started.then(() => {
    const sources = listTreeViewSources(instances, options.meshes, hasWinter(uniforms));
    const sparse: PropMesh[] = [];
    for (const { meshId } of sources) sparse[meshId] = options.meshes[meshId]!;
    return options.builders.bakeTreeViews(sparse, sources, options.leafAtlas, options.budgetBytes);
  });
  let reported: BakedTreeViews | null = null;
  const layer = createDeferredLayer(bake, baked => {
    reported = baked;
    const textures = {
      albedo: createAtlasTexture(baked.albedo, baked.width, baked.height, baked.albedoMips),
      normals: createAtlasTexture(baked.normals, baked.width / 2, baked.height / 2, baked.normalMips)
    };
    const views = createTreeViews(instances, baked, textures, uniforms,
      { chunksX: options.chunksX, elevationBlend: options.elevationBlend });
    return {
      caster: null,
      dispose: views.dispose,
      mesh: views.mesh,
      refreshTree: views.refreshTree,
      setCasterChunkMask: () => {},
      setChunkMask: views.setChunkMask,
      setTreeVisible: views.setTreeVisible,
      textures: [textures.albedo, textures.normals]
    };
  }, instances, options.isPresent, { warmup: options.warmup });
  void layer.ready.then(shown => {
    if (shown && reported) reportBaked(reported, listTreeViewInstances(instances).length, startedAt);
    reported = null;
  });
  const plantMask = createPlantMask(options.chunksX, options.chunksZ);
  return {
    ...layer,
    dispose: () => {
      layer.dispose();
      plantMask.texture.dispose();
    },
    plantMask,
    start
  };
};
