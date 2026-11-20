import { Box3, type DataTexture, Group, type IUniform, type Object3D, Vector3 } from "three";

import type { BakedSprites } from "../../render-common/baker/prop-baker";
import type { PropInstances } from "../../render-common/props/prop-instances";
import type { LayerWarmup } from "./impostor-warmup";
import { createImpostors, TREE_KIND_SET } from "./three-impostors";
import { createAtlasTexture } from "./three-materials";
import { hasWinter } from "./three-prop-materials";

/** World box of every prop anchor (the impostor quads stand on them). */
const getInstanceBounds = (instances: PropInstances) => {
  const bounds = new Box3();
  const point = new Vector3();
  for (let index = 0; index < instances.count; index++) {
    bounds.expandByPoint(point.set(instances.x[index]!, instances.y[index]!, instances.z[index]!));
  }
  return bounds;
};

/** A far layer built from its bake: GPU objects plus the per-tree edits. */
export interface DeferredLayerParts {
  caster: Object3D | null;
  dispose: () => void;
  mesh: Object3D;
  refreshTree: (sourceIndex: number) => void;
  setCasterChunkMask: (mask: DataTexture | null) => void;
  setChunkMask: (mask: DataTexture | null) => void;
  setTreeVisible: (sourceIndex: number, visible: boolean) => void;
  textures: DataTexture[];
}

export interface DeferredLayerOptions {
  chunkMask?: DataTexture | null;
  warmup?: LayerWarmup;
}

/**
 * A far layer built once its bake (a worker job) arrives: until then the full meshes stay
 * (`isReady`); trees hidden meanwhile (felled, growing) stay hidden when the layer appears. With
 * `warmup` the built layer stays hidden until its textures and programs are resident, so its first
 * draw has no upload or link stall.
 */
export const createDeferredLayer = <Baked>(
  bake: Promise<Baked>,
  build: (baked: Baked) => DeferredLayerParts,
  instances: PropInstances,
  isPresent: (sourceIndex: number) => boolean,
  options: DeferredLayerOptions = {}
) => {
  const mesh = new Group();
  const caster = new Group();
  const hidden = new Set<number>();
  let parts: DeferredLayerParts | null = null;
  let chunkMask = options.chunkMask ?? null;
  let casterChunkMask = options.chunkMask ?? null;
  let disposed = false;
  let shown = false;
  let cancelWarmup = () => {};

  const warm = async (built: DeferredLayerParts) => {
    if (!options.warmup) return;
    const layers = built.caster ? [built.mesh, built.caster] : [built.mesh];
    const warmup = options.warmup(built.textures, layers, getInstanceBounds(instances));
    cancelWarmup = warmup.cancel;
    await warmup.done;
  };

  const release = () => {
    parts?.dispose();
    for (const texture of parts?.textures ?? []) texture.dispose();
    parts = null;
  };

  const ready = bake.then(async (baked) => {
    if (disposed) return false;
    parts = build(baked);
    parts.setChunkMask(chunkMask);
    parts.setCasterChunkMask(casterChunkMask);
    for (const sourceIndex of instances.sourceIndex)
      if (!isPresent(sourceIndex)) hidden.add(sourceIndex);
    for (const sourceIndex of hidden) parts.setTreeVisible(sourceIndex, false);
    await warm(parts);
    if (disposed) return false;
    mesh.add(parts.mesh);
    if (parts.caster) caster.add(parts.caster);
    shown = true;
    return true;
  }).catch(() => {
    // A failed optional bake leaves the existing full meshes active.
    release();
  });

  const setTreeVisible = (sourceIndex: number, visible: boolean) => {
    visible = visible && isPresent(sourceIndex);
    if (visible) hidden.delete(sourceIndex);
    else hidden.add(sourceIndex);
    parts?.setTreeVisible(sourceIndex, visible);
  };

  return {
    ready,
    caster,
    dispose: () => {
      disposed = true;
      cancelWarmup();
      release();
      shown = false;
      mesh.clear();
      caster.clear();
      hidden.clear();
    },
    isReady: () => shown,
    mesh,
    /** Before the bake the layer is built from the current mesh ids: nothing to refresh. */
    refreshTree: (sourceIndex: number) => parts?.refreshTree(sourceIndex),
    setChunkMask: (mask: DataTexture | null) => {
      chunkMask = mask;
      parts?.setChunkMask(mask);
    },
    setCasterChunkMask: (mask: DataTexture | null) => {
      casterChunkMask = mask;
      parts?.setCasterChunkMask(mask);
    },
    setTreeVisible,
    treeKinds: TREE_KIND_SET
  };
};

/** The far zoom sprite layer (iso bake): every tree and world plant as one camera-facing quad. */
export const createDeferredImpostors = (
  bake: Promise<BakedSprites>,
  instances: PropInstances,
  uniforms: Record<string, IUniform>,
  isPresent: (sourceIndex: number) => boolean = () => true,
  options: DeferredLayerOptions & { chunksX?: number } = {}
) => createDeferredLayer(bake, (baked): DeferredLayerParts => {
  const { albedo, albedoMips, height, normalMips, normals, width, wind } = baked.atlas;
  const maps = {
    albedo: createAtlasTexture(albedo, width, height, albedoMips),
    normals: createAtlasTexture(normals, width, height, normalMips),
    wind: hasWinter(uniforms) ? createAtlasTexture(wind, width / 2, height / 2) : null
  };
  const impostors = createImpostors(instances, baked, maps, uniforms, { chunksX: options.chunksX });
  return {
    caster: impostors.caster,
    dispose: () => {
      impostors.mesh.geometry.dispose();
      impostors.mesh.material.dispose();
      impostors.caster.material.dispose();
    },
    mesh: impostors.mesh,
    refreshTree: impostors.refreshTree,
    setCasterChunkMask: impostors.setCasterChunkMask,
    setChunkMask: impostors.setChunkMask,
    setTreeVisible: impostors.setTreeVisible,
    textures: [maps.albedo, maps.normals, ...(maps.wind ? [maps.wind] : [])]
  };
}, instances, isPresent, options);
