import {
  BufferAttribute,
  type DataTexture,
  DoubleSide,
  GLSL3,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  type IUniform,
  Mesh,
  RawShaderMaterial
} from "three";

import type { BakedTreeViews } from "../../render-common/baker/tree-view-baker";
import { TREE_VIEW_MARGIN, type TreeViewEntry } from "../../render-common/baker/tree-view-layout";
import type { PropInstances } from "../../render-common/props/prop-instances";
import { getMeshKind } from "../../render-common/props/prop-meshes";
import { excludeFromAmbientOcclusion } from "./ambient-occlusion-exclusion";
import { getMeshSeasonClass } from "./seasonal-prop-materials";
import { TREE_KIND_SET } from "./three-impostors";
import { getWinterDefines } from "./three-prop-materials";
import { TREE_VIEW_FRAGMENT_GLSL, TREE_VIEW_VERTEX_GLSL } from "./three-tree-view-shaders";
import { getCullChunk } from "./three-visibility";

const QUAD_CORNERS = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const QUAD_INDICES = new Uint16Array([0, 2, 1, 0, 3, 2]);

/** World tree instances that stand in the possessed far tier (every tree kind instance). */
export const listTreeViewInstances = (instances: PropInstances) => {
  const indices: number[] = [];
  for (let index = 0; index < instances.count; index += 1) {
    if (TREE_KIND_SET.has(getMeshKind(instances.meshIds[index]!))) indices.push(index);
  }
  return indices;
};

interface EntryLookup {
  bare: Map<number, TreeViewEntry>;
  leafy: Map<number, TreeViewEntry>;
}

const createEntryLookup = (entries: readonly TreeViewEntry[]): EntryLookup => {
  const lookup: EntryLookup = { bare: new Map(), leafy: new Map() };
  for (const entry of entries) (entry.bare ? lookup.bare : lookup.leafy).set(entry.meshId, entry);
  return lookup;
};

/** Per-instance attributes of one slot (sizes in ATTRIBUTE_SIZES order). */
const ATTRIBUTE_SIZES = {
  anchor: 3, bareBlock: 2, block: 4, bounds: 4, params: 4, tint: 3, transform: 4
} as const;

type AttributeName = keyof typeof ATTRIBUTE_SIZES;

const getBlockValues = (entry: TreeViewEntry, baked: BakedTreeViews) => [
  entry.x / baked.width,
  entry.y / baked.height,
  entry.frameWidth / baked.width,
  entry.frameHeight / baked.height
];

/** Every attribute value of a tree slot; null when its mesh has no baked block. */
const getSlotValues = (
  instances: PropInstances,
  index: number,
  lookup: EntryLookup,
  baked: BakedTreeViews,
  chunksX: number
): Record<AttributeName, number[]> | null => {
  const meshId = instances.meshIds[index]!;
  const entry = lookup.leafy.get(meshId);
  if (!entry) return null;
  const block = getBlockValues(entry, baked);
  const bare = lookup.bare.get(meshId);
  const x = instances.x[index]!;
  const z = instances.z[index]!;
  return {
    anchor: [x, instances.y[index]!, z],
    bareBlock: bare ? [bare.x / baked.width, bare.y / baked.height] : [block[0]!, block[1]!],
    block,
    // w: the foliage kind (0, 0.5, 1) plus twice the season class of the prop kind.
    bounds: [entry.radius, entry.yMin, entry.yMax, entry.foliage + 2 * getMeshSeasonClass(meshId)],
    params: [instances.sunVisibility[index]!, instances.fog[index]!, chunksX ? getCullChunk(x, z, chunksX) : 0, 1],
    tint: [instances.tint[index * 3]!, instances.tint[index * 3 + 1]!, instances.tint[index * 3 + 2]!],
    transform: [instances.rotation[index]!, instances.scale[index]!, instances.stretch[index]!, instances.phase[index]!]
  };
};

const createGeometry = (count: number) => {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("corner", new BufferAttribute(QUAD_CORNERS, 2));
  geometry.setIndex(new BufferAttribute(QUAD_INDICES, 1));
  for (const [name, size] of Object.entries(ATTRIBUTE_SIZES)) {
    geometry.setAttribute(name, new InstancedBufferAttribute(new Float32Array(count * size), size));
  }
  geometry.instanceCount = count;
  return geometry;
};

const createMaterial = (
  uniforms: Record<string, IUniform>,
  baked: { albedo: DataTexture; normals: DataTexture },
  elevationBlend: boolean
) => {
  const material = new RawShaderMaterial({
    defines: {
      ...(elevationBlend ? { VIEW_ELEVATION_BLEND: "" } : {}),
      ...getWinterDefines(uniforms)
    },
    fragmentShader: TREE_VIEW_FRAGMENT_GLSL,
    glslVersion: GLSL3,
    side: DoubleSide,
    uniforms: {
      ...uniforms,
      uChunkMask: { value: null },
      uChunksX: { value: 0 },
      uMarginTexels: { value: [TREE_VIEW_MARGIN, TREE_VIEW_MARGIN] },
      uMaskEnabled: { value: 0 },
      uViewAlbedo: { value: baked.albedo },
      uViewNormal: { value: baked.normals }
    },
    vertexShader: TREE_VIEW_VERTEX_GLSL
  });
  // A camera-facing card has flat depth: no screen-space occlusion (like the iso impostors).
  return excludeFromAmbientOcclusion(material);
};

export interface TreeViewTextures {
  albedo: DataTexture;
  normals: DataTexture;
}

/**
 * R15a: the possessed far tier of the world trees as hemispherical view impostors. One quad per
 * tree (instanced, one draw); the chunk mask (red: trees) hides those whose 3D chunk is near.
 */
export const createTreeViews = (
  instances: PropInstances,
  baked: BakedTreeViews,
  textures: TreeViewTextures,
  uniforms: Record<string, IUniform>,
  options: { chunksX?: number; elevationBlend: boolean }
) => {
  const trees = listTreeViewInstances(instances);
  const lookup = createEntryLookup(baked.layout.entries);
  const geometry = createGeometry(trees.length);
  const slots = new Map(trees.map((index, slot) => [instances.sourceIndex[index]!, slot]));
  const visible = new Uint8Array(trees.length).fill(1);
  const write = (slot: number, partial: boolean) => {
    const values = getSlotValues(instances, trees[slot]!, lookup, baked, options.chunksX ?? 0);
    if (values) values.params[3] = visible[slot]!;
    for (const name of Object.keys(ATTRIBUTE_SIZES) as AttributeName[]) {
      const attribute = geometry.getAttribute(name) as InstancedBufferAttribute;
      const size = ATTRIBUTE_SIZES[name];
      const array = attribute.array as Float32Array;
      if (values) array.set(values[name], slot * size);
      else array.fill(0, slot * size, slot * size + size);
      if (!partial) continue;
      attribute.addUpdateRange(slot * size, size);
      attribute.needsUpdate = true;
    }
  };
  for (let slot = 0; slot < trees.length; slot += 1) write(slot, false);
  const material = createMaterial(uniforms, textures, options.elevationBlend);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  const setTreeVisible = (sourceIndex: number, shown: boolean) => {
    const slot = slots.get(sourceIndex);
    if (slot === undefined || visible[slot] === Number(shown)) return;
    visible[slot] = shown ? 1 : 0;
    const params = geometry.getAttribute("params") as InstancedBufferAttribute;
    (params.array as Float32Array)[slot * 4 + 3] = visible[slot]!;
    params.addUpdateRange(slot * 4 + 3, 1);
    params.needsUpdate = true;
  };
  /** A tree's mesh or ground height changed: its block, bounds and anchor follow. */
  const refreshTree = (sourceIndex: number) => {
    const slot = slots.get(sourceIndex);
    if (slot !== undefined) write(slot, true);
  };
  const setChunkMask = (mask: DataTexture | null) => {
    material.uniforms.uChunkMask!.value = mask;
    material.uniforms.uChunksX!.value = mask ? (options.chunksX ?? 0) : 0;
    material.uniforms.uMaskEnabled!.value = mask ? 1 : 0;
  };
  return {
    count: trees.length,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
    mesh,
    refreshTree,
    setChunkMask,
    setTreeVisible
  };
};
