import {
  BufferAttribute,
  BufferGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material
} from "three";

import type { PropMesh } from "../../render-common/props/mesh-builder";
import type { PropInstances } from "../../render-common/props/prop-instances";
import { getMeshKind } from "../../render-common/props/prop-meshes";
import { applyGroundTilt } from "../../render-common/props/shore-rest";
import {
  createPropChunkLayout,
  planPropChunkLayout,
  type PropChunkLayout,
  resetPropChunkLayout
} from "./props/prop-chunk-layout";
import { CULL_CHUNK_CELLS, getCullChunk } from "./three-visibility";

export const createPropGeometry = (mesh: PropMesh) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("color", new BufferAttribute(mesh.colors, 3));
  geometry.setAttribute("wind", new BufferAttribute(mesh.wind, 2));
  geometry.setAttribute("uv", new BufferAttribute(mesh.uvs, 2));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  return geometry;
};

/** Ground tilt (applyGroundTilt) of the three axis columns of an upright matrix, in place. */
const tiltColumns = (target: Float32Array, offset: number, nx: number, nz: number) => {
  for (let column = 0; column < 3; column += 1) {
    const at = offset + column * 4;
    target.set(applyGroundTilt(nx, nz, [target[at]!, target[at + 1]!, target[at + 2]!]), at);
  }
};

/** Column major matrix: rotation around y, scale (height times the stretch), ground tilt, translation. */
export const writeMatrix = (
  target: Float32Array,
  offset: number,
  instances: PropInstances,
  index: number
) => {
  const scale = instances.scale[index]!;
  const cos = Math.cos(instances.rotation[index]!) * scale;
  const sin = Math.sin(instances.rotation[index]!) * scale;
  const height = scale * instances.stretch[index]!;
  target.set([cos, 0, -sin, 0, 0, height, 0, 0, sin, 0, cos, 0], offset);
  target.set([instances.x[index]!, instances.y[index]!, instances.z[index]!, 1], offset + 12);
  const tilt = instances.tilt;
  if (tilt && (tilt[index * 2] !== 0 || tilt[index * 2 + 1] !== 0))
    tiltColumns(target, offset, tilt[index * 2]!, tilt[index * 2 + 1]!);
};

/** Instance data of one mesh id, kept per culling chunk. */
interface ChunkData {
  count: number;
  data: Float32Array;
  matrices: Float32Array;
  /** World prop index per slot (-1 for render only props). */
  sources: Int32Array;
  tint: Float32Array;
}

const createChunkData = (instances: PropInstances, indices: number[]): ChunkData => {
  const chunk: ChunkData = {
    count: indices.length,
    data: new Float32Array(indices.length * 4),
    matrices: new Float32Array(indices.length * 16),
    sources: Int32Array.from(indices, (index) => instances.sourceIndex[index]!),
    tint: new Float32Array(indices.length * 3)
  };
  indices.forEach((index, slot) => {
    writeMatrix(chunk.matrices, slot * 16, instances, index);
    chunk.data.set(
      [instances.phase[index]!, instances.sunVisibility[index]!, instances.fog[index]!, 0],
      slot * 4
    );
    chunk.tint.set(instances.tint.subarray(index * 3, index * 3 + 3), slot * 3);
  });
  return chunk;
};

type ChunkArray = Float32Array | Int32Array;

const joinArrays = <T extends ChunkArray>(first: T, second: T): T => {
  const joined = new (first.constructor as new (length: number) => T)(first.length + second.length);
  joined.set(first);
  joined.set(second, first.length);
  return joined;
};

const withoutSlot = <T extends ChunkArray>(array: T, slot: number, stride: number): T => {
  const result = new (array.constructor as new (length: number) => T)(array.length - stride);
  result.set(array.subarray(0, slot * stride));
  result.set(array.subarray((slot + 1) * stride), slot * stride);
  return result;
};

/** The chunk with one more (visible) instance at its end. */
const appendToChunk = (chunk: ChunkData | undefined, instances: PropInstances, index: number) => {
  const added = createChunkData(instances, [index]);
  if (!chunk) return added;
  return {
    count: chunk.count + 1,
    data: joinArrays(chunk.data, added.data),
    matrices: joinArrays(chunk.matrices, added.matrices),
    sources: joinArrays(chunk.sources, added.sources),
    tint: joinArrays(chunk.tint, added.tint)
  };
};

const removeFromChunk = (chunk: ChunkData, slot: number): ChunkData => ({
  count: chunk.count - 1,
  data: withoutSlot(chunk.data, slot, 4),
  matrices: withoutSlot(chunk.matrices, slot, 16),
  sources: withoutSlot(chunk.sources, slot, 1),
  tint: withoutSlot(chunk.tint, slot, 3)
});

/**
 * One InstancedMesh per mesh id whose instance buffers hold only the visible chunks: culling
 * without extra draw calls. A visible chunk set change rewrites and uploads only the changed part
 * of the buffers (prop-chunk-layout), never the whole capacity.
 */
export interface ChunkedPropMesh {
  /** Terrain edits update cached chunks and visible matrices together. */
  refreshHeights: (heights: ReadonlyMap<number, number>) => void;
  /** Adds a world prop with its current instance data (a tree that grew into this mesh). */
  addInstance: (index: number) => void;
  caster: InstancedMesh | null;
  /** Lays out the visible chunks again after instances were added or removed. */
  commitInstances: () => void;
  /** Stops drawing one world prop (a felled or growing tree); false when not in this mesh. */
  hideInstance: (sourceIndex: number) => boolean;
  /** Draws a hidden world prop again (a tree that finished growing). */
  showInstance: (sourceIndex: number) => boolean;
  kind: number;
  mesh: InstancedMesh;
  meshId: number;
  /** Removes a world prop from this mesh; false when it is not in it. */
  removeInstance: (sourceIndex: number) => boolean;
  /**
   * Replaces whole culling chunks (map editor: field cover of edited ground): the chunks' old
   * instances go, `indices` of `instances` (this mesh's, inside those chunks) come in.
   */
  replaceChunks: (chunks: ReadonlySet<number>, instances: PropInstances, indices: number[]) => void;
  /** LOD: false draws only the simplified plant (core triangles), true the full one. */
  setDetail: (full: boolean) => void;
  /** Lays out the chunk set used by the sun-depth pass; the colour mesh stays unchanged. */
  showCasterChunks: (visible: Uint8Array) => void;
  showChunks: (visible: Uint8Array) => void;
  triangles: number;
  /** Returns the depth pass to the colour mesh's shared chunk set (leaving FPS/iso shadows). */
  useMainCaster: () => void;
}

interface PropMaterials {
  depth: Material | null;
  main: Material;
}

interface ChunkSource {
  chunksX: number;
  instances: PropInstances;
}

/** Instance buffers with room for `capacity` instances (matrix, data, tint). */
const createInstanceBuffers = (capacity: number) => ({
  data: new InstancedBufferAttribute(new Float32Array(capacity * 4), 4),
  matrix: new InstancedBufferAttribute(new Float32Array(capacity * 16), 16),
  tint: new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
});

/**
 * Queues the upload of a rewritten buffer tail. Ranges already queued from `start` on are absorbed,
 * so a mesh that stays undrawn (no upload) through many view changes keeps one tail range.
 */
const queueTailUpload = (attribute: InstancedBufferAttribute, start: number, count: number) => {
  let end = start + count;
  const ranges = attribute.updateRanges;
  for (let index = ranges.length - 1; index >= 0; index--) {
    const range = ranges[index]!;
    if (range.start < start) continue;
    end = Math.max(end, range.start + range.count);
    ranges.splice(index, 1);
  }
  attribute.addUpdateRange(start, end - start);
  attribute.needsUpdate = true;
};

/** Room added when replaced chunks need more instances than the buffers hold. */
const GROWTH_FACTOR = 1.25;

const createChunkedMesh = (
  geometry: BufferGeometry,
  chunks: Map<number, ChunkData>,
  total: number,
  materials: PropMaterials,
  source: ChunkSource & { coreIndexCount?: number; lodMinimalIndices?: Uint16Array }
) => {
  const shared = geometry.clone();
  const fullIndex = shared.index!;
  const minimalIndex = source.lodMinimalIndices ? new BufferAttribute(source.lodMinimalIndices, 1) : null;
  let buffers = createInstanceBuffers(total);
  const mesh = new InstancedMesh(shared, materials.main, total);
  mesh.frustumCulled = false;
  const caster = materials.depth ? new InstancedMesh(shared, materials.depth, total) : null;
  if (caster) caster.frustumCulled = false;
  /**
   * The colour and depth passes share buffers until an FPS shadow mask needs a different chunk
   * set. Only then is a second instance buffer allocated, so iso/ordinary play keeps its memory.
   */
  let casterBuffers: ReturnType<typeof createInstanceBuffers> | null = null;
  let casterGeometry: BufferGeometry | null = null;
  let detailFull = true;
  const applyDetail = (target: BufferGeometry) => {
    if (minimalIndex) target.setIndex(detailFull ? fullIndex : minimalIndex);
    if (source.coreIndexCount === undefined) return;
    target.setDrawRange(0, detailFull ? Infinity : source.coreIndexCount);
  };
  applyDetail(shared);
  const attachCaster = () => {
    if (!caster) return;
    if (!casterBuffers) {
      caster.geometry = shared;
      caster.instanceMatrix = buffers.matrix;
      return;
    }
    if (!casterGeometry) {
      casterGeometry = shared.clone();
      applyDetail(casterGeometry);
      caster.geometry = casterGeometry;
    }
    casterGeometry.setAttribute("instanceData", casterBuffers.data);
    casterGeometry.setAttribute("instanceTint", casterBuffers.tint);
    caster.instanceMatrix = casterBuffers.matrix;
  };
  /** Puts the buffers on the geometry and both meshes (again after they grew). */
  const attachBuffers = () => {
    shared.setAttribute("instanceData", buffers.data);
    shared.setAttribute("instanceTint", buffers.tint);
    mesh.instanceMatrix = buffers.matrix;
    attachCaster();
  };
  attachBuffers();
  /**
   * Replaced attributes keep their GL buffers until their owner's dispose event: free the outgoing
   * instance buffers before larger ones replace them (base attributes upload again on next draw).
   */
  const releaseReplacedBuffers = () => {
    shared.dispose();
    casterGeometry?.dispose();
    mesh.dispose();
    caster?.dispose();
  };
  const layout = createPropChunkLayout();
  const casterLayout = createPropChunkLayout();
  const countOf = (chunk: number) => chunks.get(chunk)?.count ?? 0;
  /** Instances of `chunk` changed: both buffers rewrite it (and what follows) on the next layout. */
  const markDirty = (chunk: number) => {
    layout.dirty.add(chunk);
    casterLayout.dirty.add(chunk);
  };
  let lastVisible: Uint8Array | null = null;
  let lastCasterVisible: Uint8Array | null = null;
  let membersChanged = false;
  let members = [...chunks.values()].reduce((sum, chunk) => sum + chunk.count, 0);

  /** Lays out `visible` and queues the upload of the rewritten instances only. */
  const fill = (
    target: ReturnType<typeof createInstanceBuffers>,
    chunkLayout: PropChunkLayout,
    visible: Uint8Array
  ) => {
    const { data, matrix, tint } = target;
    const { fromIndex, fromOffset } =
      planPropChunkLayout(chunkLayout, chunks.keys(), visible, countOf, source.chunksX);
    const { order } = chunkLayout;
    for (let index = fromIndex; index < order.length; index++) {
      const chunkData = chunks.get(order[index]!)!;
      const offset = chunkLayout.offsets.get(order[index]!)!;
      (matrix.array as Float32Array).set(chunkData.matrices, offset * 16);
      (data.array as Float32Array).set(chunkData.data, offset * 4);
      (tint.array as Float32Array).set(chunkData.tint, offset * 3);
    }
    const written = chunkLayout.count - fromOffset;
    if (written <= 0) return chunkLayout.count;
    for (const attribute of [data, matrix, tint])
      queueTailUpload(attribute, fromOffset * attribute.itemSize, written * attribute.itemSize);
    return chunkLayout.count;
  };

  const showChunks = (visible: Uint8Array) => {
    lastVisible = visible.slice();
    membersChanged = false;
    const count = fill(buffers, layout, visible);
    mesh.count = count;
    if (caster && !casterBuffers) caster.count = count;
  };

  /**
   * The separate FPS caster holds a few near chunks: bounding its instances lets each shadow
   * cascade cull it (R08) instead of submitting every prop kind to every tile.
   */
  const boundCaster = () => {
    if (!caster) return;
    caster.computeBoundingSphere();
    caster.frustumCulled = true;
  };

  /** Independent sun-pass chunk mask: near chunks outside the main view keep casting shadows. */
  const showCasterChunks = (visible: Uint8Array) => {
    if (!caster) return;
    if (!casterBuffers) {
      casterBuffers = createInstanceBuffers(total);
      resetPropChunkLayout(casterLayout);
      attachCaster();
    }
    lastCasterVisible = visible.slice();
    caster.count = fill(casterBuffers, casterLayout, visible);
    boundCaster();
  };

  /** Sets the hidden flag of one world prop; false when it is not in this mesh. */
  const setHidden = (sourceIndex: number, hidden: boolean) => {
    const flag = hidden ? 1 : 0;
    for (const [chunk, chunkData] of chunks) {
      const slot = chunkData.sources.indexOf(sourceIndex);
      if (slot < 0) continue;
      chunkData.data[slot * 4 + 3] = flag;
      const visibleOffset = layout.offsets.get(chunk);
      if (visibleOffset !== undefined) {
        (buffers.data.array as Float32Array)[(visibleOffset + slot) * 4 + 3] = flag;
        buffers.data.addUpdateRange((visibleOffset + slot) * 4 + 3, 1);
        buffers.data.needsUpdate = true;
      }
      const casterOffset = casterLayout.offsets.get(chunk);
      if (casterBuffers && casterOffset !== undefined) {
        (casterBuffers.data.array as Float32Array)[(casterOffset + slot) * 4 + 3] = flag;
        casterBuffers.data.addUpdateRange((casterOffset + slot) * 4 + 3, 1);
        casterBuffers.data.needsUpdate = true;
      }
      return true;
    }
    return false;
  };
  const addInstance = (index: number) => {
    if (members >= total) return;
    const { chunksX, instances } = source;
    const chunk = getCullChunk(instances.x[index]!, instances.z[index]!, chunksX);
    chunks.set(chunk, appendToChunk(chunks.get(chunk), instances, index));
    markDirty(chunk);
    members += 1;
    membersChanged = true;
  };
  const removeInstance = (sourceIndex: number) => {
    for (const [chunk, chunkData] of chunks) {
      const slot = chunkData.sources.indexOf(sourceIndex);
      if (slot < 0) continue;
      chunks.set(chunk, removeFromChunk(chunkData, slot));
      markDirty(chunk);
      members -= 1;
      membersChanged = true;
      return true;
    }
    return false;
  };
  const replaceChunks = (
    replaced: ReadonlySet<number>,
    instances: PropInstances,
    indices: number[]
  ) => {
    for (const chunk of replaced) {
      members -= chunks.get(chunk)?.count ?? 0;
      chunks.delete(chunk);
      markDirty(chunk);
    }
    for (const [chunk, list] of groupByChunk(instances, indices, source.chunksX)) {
      chunks.set(chunk, createChunkData(instances, list));
      markDirty(chunk);
      members += list.length;
    }
    if (members > total) {
      total = Math.ceil(members * GROWTH_FACTOR);
      releaseReplacedBuffers();
      buffers = createInstanceBuffers(total);
      if (casterBuffers) casterBuffers = createInstanceBuffers(total);
      resetPropChunkLayout(layout);
      resetPropChunkLayout(casterLayout);
      attachBuffers();
    }
    membersChanged = true;
  };
  const commitInstances = () => {
    if (!membersChanged) return;
    if (lastVisible) showChunks(lastVisible);
    if (lastCasterVisible) showCasterChunks(lastCasterVisible);
  };
  const refreshHeights = (heights: ReadonlyMap<number, number>) => {
    for (const [chunk, chunkData] of chunks) {
      const offset = layout.offsets.get(chunk);
      const casterOffset = casterLayout.offsets.get(chunk);
      for (let slot = 0; slot < chunkData.count; slot++) {
        const height = heights.get(chunkData.sources[slot]!);
        if (height === undefined) continue;
        chunkData.matrices[slot * 16 + 13] = height;
        if (offset !== undefined) {
          (buffers.matrix.array as Float32Array)[(offset + slot) * 16 + 13] = height;
          buffers.matrix.addUpdateRange((offset + slot) * 16 + 13, 1);
          buffers.matrix.needsUpdate = true;
        }
        if (casterBuffers && casterOffset !== undefined) {
          (casterBuffers.matrix.array as Float32Array)[(casterOffset + slot) * 16 + 13] = height;
          casterBuffers.matrix.addUpdateRange((casterOffset + slot) * 16 + 13, 1);
          casterBuffers.matrix.needsUpdate = true;
        }
      }
    }
    if (casterBuffers) boundCaster();
  };
  const setDetail = (full: boolean) => {
    if ((source.coreIndexCount === undefined && !minimalIndex) || detailFull === full) return;
    detailFull = full;
    applyDetail(shared);
    if (casterGeometry) applyDetail(casterGeometry);
  };
  const useMainCaster = () => {
    if (!caster || !casterBuffers) return;
    // three.js frees an instanceMatrix buffer only on the mesh's dispose event: release the private
    // FPS matrix (and the caster's vertex array states) before the shared buffers return.
    caster.dispose();
    casterBuffers = null;
    resetPropChunkLayout(casterLayout);
    casterGeometry?.dispose();
    casterGeometry = null;
    lastCasterVisible = null;
    caster.geometry = shared;
    caster.instanceMatrix = buffers.matrix;
    caster.count = mesh.count;
    caster.frustumCulled = false;
  };
  return {
    addInstance,
    caster,
    commitInstances,
    hideInstance: (sourceIndex: number) => setHidden(sourceIndex, true),
    mesh,
    removeInstance,
    refreshHeights,
    replaceChunks,
    setDetail,
    shared,
    showCasterChunks,
    showChunks,
    showInstance: (sourceIndex: number) => setHidden(sourceIndex, false),
    useMainCaster
  };
};

/** The instances (indices) grouped by culling chunk. */
const groupByChunk = (instances: PropInstances, indices: Iterable<number>, chunksX: number) => {
  const byChunk = new Map<number, number[]>();
  for (const index of indices) {
    const chunk = getCullChunk(instances.x[index]!, instances.z[index]!, chunksX);
    const list = byChunk.get(chunk) ?? [];
    list.push(index);
    byChunk.set(chunk, list);
  }
  return byChunk;
};

/** Instance indices per mesh id. */
export const groupByMesh = (instances: PropInstances) => {
  const groups = new Map<number, number[]>();
  for (let index = 0; index < instances.count; index += 1) {
    const meshId = instances.meshIds[index]!;
    const list = groups.get(meshId) ?? [];
    list.push(index);
    groups.set(meshId, list);
  }
  return groups;
};

/** Instance indices grouped by mesh id, then by culling chunk. */
const groupInstances = (instances: PropInstances, chunksX: number) =>
  new Map(
    [...groupByMesh(instances)].map(([meshId, indices]) => [
      meshId,
      groupByChunk(instances, indices, chunksX)
    ])
  );

/** Low plants skip the sun shadow pass: their root zone decal grounds them more cheaply. */
const LOW_PLANT_HEIGHT = 0.3;

const castsSunShadow = (mesh: PropMesh) =>
  mesh.castsShadow ?? (mesh.contactRadius === undefined || mesh.height > LOW_PLANT_HEIGHT);

/**
 * Chunk culled instanced meshes per mesh id, with optional depth-only twins for the sun pass.
 * `capacities`: room for instances that can be added later (mature trees grown from younger
 * ones) per mesh id; those meshes exist even while empty.
 */
export const createThreePropMeshes = (
  meshes: PropMesh[],
  instances: PropInstances,
  cellsX: number,
  /** One set for every mesh, or one per prop kind (the season classes of the vegetation). */
  materials: PropMaterials | ((kind: number) => PropMaterials),
  capacities = new Map<number, number>()
): ChunkedPropMesh[] => {
  const chunksX = Math.ceil(cellsX / CULL_CHUNK_CELLS);
  const groups = groupInstances(instances, chunksX);
  for (const meshId of capacities.keys()) if (!groups.has(meshId)) groups.set(meshId, new Map());
  const result: ChunkedPropMesh[] = [];
  for (const [meshId, byChunk] of groups) {
    const chunks = new Map<number, ChunkData>();
    let total = 0;
    for (const [chunk, indices] of byChunk) {
      chunks.set(chunk, createChunkData(instances, indices));
      total += indices.length;
    }
    const propMesh = meshes[meshId]!;
    const kind = getMeshKind(meshId);
    const meshMaterials = typeof materials === "function" ? materials(kind) : materials;
    const chunked = createChunkedMesh(
      createPropGeometry(propMesh),
      chunks,
      Math.max(total, capacities.get(meshId) ?? 0),
      castsSunShadow(propMesh) ? meshMaterials : { ...meshMaterials, depth: null },
      { chunksX, instances, coreIndexCount: propMesh.coreIndexCount,
        lodMinimalIndices: propMesh.lodMinimalIndices }
    );
    result.push({
      ...chunked,
      kind,
      meshId,
      triangles: (propMesh.indices.length / 3) * total
    });
  }
  return result;
};
