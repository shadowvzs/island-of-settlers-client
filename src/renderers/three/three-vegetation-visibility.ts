import type { DataTexture } from "three";

import { TREE_KIND_SET } from "./three-impostors";
import type { ChunkedPropMesh } from "./three-props";
import { createDistanceVisibility } from "./three-visibility";

export type DistanceVisibility = ReturnType<typeof createDistanceVisibility>;

/** Reuses a distance mask until its threshold changes; undefined removes the mask. */
export const refreshDistanceVisibility = (
  current: DistanceVisibility | null,
  currentDistance: number | undefined,
  distance: number | undefined,
  cellsX: number,
  cellsZ: number
): { distance: number | undefined; visibility: DistanceVisibility | null } => {
  if (distance === undefined) return { distance: undefined, visibility: null };
  if (current && currentDistance === distance) return { distance, visibility: current };
  return { distance, visibility: createDistanceVisibility(cellsX, cellsZ, distance) };
};

/** Rewrites the colour mask and, for the FPS sun pass, the independent caster mask. */
export const refreshImpostorMasks = (
  treeVisibility: DistanceVisibility | null,
  plantVisibility: DistanceVisibility | null,
  visibility: Uint8Array,
  casterVisibility: Uint8Array,
  shadow: boolean,
  chunkMaskPixels: Uint8Array,
  chunkMask: DataTexture,
  casterMaskPixels: Uint8Array,
  casterMask: DataTexture
) => {
  chunkMaskPixels.fill(0);
  for (let index = 0; index < visibility.length; index += 1) {
    if (!visibility[index]) continue;
    if (!treeVisibility?.mask[index]) chunkMaskPixels[index * 2] = 255;
    if (!plantVisibility?.mask[index]) chunkMaskPixels[index * 2 + 1] = 255;
  }
  chunkMask.needsUpdate = true;
  if (!shadow) return;
  // Off-view sunward sprite shadows use the same LOD inversion, but may extend beyond the
  // main-view mask because the fitted light camera sees casters behind the player.
  casterMaskPixels.fill(0);
  for (let index = 0; index < visibility.length; index += 1) {
    if (!visibility[index] && !casterVisibility[index]) continue;
    if (!treeVisibility?.mask[index]) casterMaskPixels[index * 2] = 255;
    if (!plantVisibility?.mask[index]) casterMaskPixels[index * 2 + 1] = 255;
  }
  casterMask.needsUpdate = true;
};

/** Lays out the near shadow casters, including chunks outside the main camera view. */
export const refreshShadowCasters = (
  props: readonly ChunkedPropMesh[],
  visibility: Uint8Array,
  casterVisibility: Uint8Array,
  treeVisibility: DistanceVisibility | null,
  plantVisibility: DistanceVisibility | null,
  treeLod: boolean,
  impostorReady: boolean,
  scratch: Uint8Array
) => {
  for (const prop of props) {
    if (!prop.caster) continue;
    const isTree = TREE_KIND_SET.has(prop.kind);
    let distanceMask: Uint8Array | null = null;
    if (isTree && treeLod && treeVisibility) distanceMask = treeVisibility.mask;
    if (!isTree && impostorReady && plantVisibility) distanceMask = plantVisibility.mask;
    for (let chunk = 0; chunk < scratch.length; chunk += 1) {
      const base = visibility[chunk] || casterVisibility[chunk];
      scratch[chunk] = base && (!distanceMask || distanceMask[chunk]) ? 1 : 0;
    }
    prop.showCasterChunks(scratch);
  }
};

/** Lays out the colour meshes: main-camera chunks, optional distance masks and grass. */
export const refreshVisibleChunks = (
  props: readonly ChunkedPropMesh[],
  grass: readonly ChunkedPropMesh[],
  visibility: Uint8Array,
  combined: Uint8Array,
  treeVisibility: DistanceVisibility | null,
  plantVisibility: DistanceVisibility | null,
  treeLod: boolean,
  impostorReady: boolean,
  grassVisibility: DistanceVisibility | null,
  baseChanged: boolean,
  treeChanged: boolean,
  plantChanged: boolean,
  grassChanged: boolean
) => {
  const combine = (mask: Uint8Array) => {
    for (let chunk = 0; chunk < combined.length; chunk += 1)
      combined[chunk] = visibility[chunk] && mask[chunk] ? 1 : 0;
    return combined;
  };
  const show = (prop: ChunkedPropMesh, mask: Uint8Array | null, changed: boolean) => {
    if (baseChanged || changed) prop.showChunks(mask ?? visibility);
  };
  for (const prop of props) {
    if (TREE_KIND_SET.has(prop.kind)) {
      show(prop, treeLod && treeVisibility ? combine(treeVisibility.mask) : null, treeChanged);
      continue;
    }
    show(prop, impostorReady && plantVisibility ? combine(plantVisibility.mask) : null, plantChanged);
  }
  for (const prop of grass) show(prop, grassVisibility ? combine(grassVisibility.mask) : null, grassChanged);
};

/**
 * Whether the 3D tree/plant meshes that have a sprite LOD are drawn. The possessed eye splits them by
 * chunk masks (near 3D, far sprites), so they must show even when the iso view hid them for the
 * sprites (Minimal always uses the sprites in iso).
 */
export const showsSpriteLodMeshes = (eyeTreeLod: boolean, showImpostors: boolean) =>
  eyeTreeLod || !showImpostors;
