import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  type Group,
  Matrix4,
  Mesh,
  type MeshBasicMaterial,
  type Object3D,
  Sphere,
  Vector3
} from "three";

import { createBuildingShadowFallback } from "./building-shadow-fallback";
import {
  buildingShadowHasVisibleTriangles,
  type BuildingShadowSlice,
  buildingShadowTriangleCount,
  writeBuildingShadowIndices,
  writeBuildingShadowPositions
} from "./building-shadow-slice";
import { isBuildingShadowMeshSource, walkBuildingShadowMeshes } from "./building-shadow-traversal";

type ShadowSource = {
  bakedMatrix: Matrix4;
  geometry: BufferGeometry | null;
  index: BufferAttribute | null;
  position: BufferAttribute | null;
  relativeMatrix: Matrix4;
  seenAt: number;
  slice?: BuildingShadowSlice;
  visible: boolean;
};

export type BuildingShadowBatchStats = {
  batchedMeshes: number;
  bytes: number;
  drawCalls: number;
  fallbackMeshes: number;
  meshes: number;
  triangles: number;
  vertices: number;
  visibleMeshes: number;
};

const EMPTY_STATS: BuildingShadowBatchStats = {
  batchedMeshes: 0,
  bytes: 0,
  drawCalls: 0,
  fallbackMeshes: 0,
  meshes: 0,
  triangles: 0,
  vertices: 0,
  visibleMeshes: 0
};

/**
 * Owns exactly one merged geometry per caster. Source geometry and shared material stay borrowed.
 */
export const createBuildingShadowBatch = (
  source: Group,
  root: Group,
  material: MeshBasicMaterial,
  enabled: boolean
) => {
  const matrices = new WeakMap<Object3D, Matrix4>();
  const sources = new Map<Mesh, ShadowSource>();
  const fallback = createBuildingShadowFallback(root, material);
  const bounds = new Box3();
  const size = new Vector3();
  let batchGeometry: BufferGeometry | null = null;
  let batchMesh: Mesh | null = null;
  let disposed = false;
  let seenAt = 0;

  const disposeBatch = () => {
    if (!batchGeometry) return;
    if (batchMesh) root.remove(batchMesh);
    batchGeometry.dispose();
    batchGeometry = null;
    batchMesh = null;
    for (const state of sources.values()) state.slice = undefined;
  };

  const totalSizes = () => {
    let vertices = 0;
    let triangles = 0;
    for (const state of sources.values()) {
      const position = state.position;
      if (!position) continue;
      vertices += position.count;
      triangles += buildingShadowTriangleCount(state.geometry!);
    }
    return { triangles, vertices };
  };

  const resetBounds = (geometry: BufferGeometry) => {
    bounds.makeEmpty();
    for (const state of sources.values()) {
      const slice = state.slice;
      if (slice && buildingShadowHasVisibleTriangles(slice)) bounds.union(slice.bounds);
    }
    if (!geometry.boundingBox) geometry.boundingBox = new Box3();
    if (!geometry.boundingSphere) geometry.boundingSphere = new Sphere();
    geometry.boundingBox.copy(bounds);
    if (bounds.isEmpty()) {
      if (batchMesh) batchMesh.visible = false;
      geometry.boundingSphere.center.set(0, 0, 0);
      geometry.boundingSphere.radius = 0;
      return;
    }
    if (batchMesh) batchMesh.visible = true;
    bounds.getCenter(geometry.boundingSphere.center);
    geometry.boundingSphere.radius = bounds.getSize(size).length() * .5;
  };

  const makeSlice = (
    state: ShadowSource,
    vertexOffset: number,
    indexOffset: number
  ): BuildingShadowSlice => {
    const position = state.position!;
    return {
      bounds: new Box3(),
      drawCount: 0,
      drawStart: 0,
      index: state.index,
      indexOffset,
      indexVersion: 0,
      mirrored: false,
      position,
      positionVersion: -1,
      triangleCount: buildingShadowTriangleCount(state.geometry!),
      vertexCount: position.count,
      vertexOffset,
      visible: false
    };
  };

  const rebuild = () => {
    disposeBatch();
    const { triangles, vertices } = totalSizes();
    if (!vertices || !triangles) return;
    const geometry = new BufferGeometry();
    const positions = new BufferAttribute(new Float32Array(vertices * 3), 3);
    const indices = new BufferAttribute(new Uint32Array(triangles * 3), 1);
    positions.setUsage(DynamicDrawUsage);
    indices.setUsage(DynamicDrawUsage);
    geometry.setAttribute("position", positions);
    geometry.setIndex(indices);
    geometry.boundingBox = new Box3();
    geometry.boundingSphere = new Sphere();
    let vertexOffset = 0;
    let indexOffset = 0;
    for (const state of sources.values()) {
      if (!state.position) continue;
      const slice = makeSlice(state, vertexOffset, indexOffset);
      state.slice = slice;
      writeBuildingShadowPositions(slice, positions, state.relativeMatrix);
      slice.positionVersion = state.position.version;
      state.bakedMatrix.copy(state.relativeMatrix);
      vertexOffset += slice.vertexCount;
      indexOffset += slice.triangleCount * 3;
    }
    batchGeometry = geometry;
    batchMesh = new Mesh(geometry, material);
    batchMesh.matrixAutoUpdate = false;
    batchMesh.name = "building-shadow-batch";
    root.add(batchMesh);
  };

  const updateSource = (state: ShadowSource) => {
    const slice = state.slice;
    const geometry = state.geometry;
    const position = state.position;
    if (!slice || !geometry || !position) return;
    const transformChanged = !state.relativeMatrix.equals(state.bakedMatrix);
    const positionChanged = position.version !== slice.positionVersion;
    const mirrored = state.relativeMatrix.determinant() < 0;
    const indexVersion = state.index?.version ?? 0;
    const indexChanged =
      state.visible !== slice.visible ||
      mirrored !== slice.mirrored ||
      geometry.drawRange.start !== slice.drawStart ||
      geometry.drawRange.count !== slice.drawCount ||
      indexVersion !== slice.indexVersion;
    slice.visible = state.visible;
    slice.drawStart = geometry.drawRange.start;
    slice.drawCount = geometry.drawRange.count;
    slice.mirrored = mirrored;
    if (transformChanged || positionChanged) {
      writeBuildingShadowPositions(
        slice,
        batchGeometry!.getAttribute("position") as BufferAttribute,
        state.relativeMatrix
      );
      state.bakedMatrix.copy(state.relativeMatrix);
      slice.positionVersion = position.version;
    }
    if (indexChanged)
      writeBuildingShadowIndices(slice, batchGeometry!.getIndex()!);
  };

  const update = () => {
    if (!enabled || disposed) return;
    source.updateWorldMatrix(true, false);
    root.matrix.copy(source.matrixWorld);
    root.matrixAutoUpdate = false;
    root.matrixWorldNeedsUpdate = true;
    seenAt++;
    let topologyChanged = false;
    fallback.begin();
    walkBuildingShadowMeshes(source, matrices, (mesh, relativeMatrix, visible) => {
      if (!isBuildingShadowMeshSource(mesh)) {
        fallback.update(mesh, relativeMatrix, visible);
        return;
      }
      let state = sources.get(mesh);
      if (!state) {
        state = {
          bakedMatrix: new Matrix4(),
          geometry: null,
          index: null,
          position: null,
          relativeMatrix: new Matrix4(),
          seenAt,
          visible
        };
        sources.set(mesh, state);
        topologyChanged = true;
      }
      const geometry = mesh.geometry;
      const position = geometry.getAttribute("position") as BufferAttribute | undefined;
      const index = geometry.getIndex();
      if (state.geometry !== geometry || state.position !== position || state.index !== index)
        topologyChanged = true;
      if (state.position?.count !== position?.count) topologyChanged = true;
      state.geometry = geometry;
      state.position = position ?? null;
      state.index = index;
      state.relativeMatrix.copy(relativeMatrix);
      state.visible = visible;
      state.seenAt = seenAt;
    });
    fallback.end();
    for (const [mesh, state] of sources) {
      if (state.seenAt !== seenAt) {
        sources.delete(mesh);
        topologyChanged = true;
      }
    }
    if (topologyChanged) rebuild();
    if (!batchGeometry) return;
    for (const state of sources.values()) updateSource(state);
    resetBounds(batchGeometry);
  };

  const getStats = (): BuildingShadowBatchStats => {
    if (!batchGeometry) return {
      ...EMPTY_STATS, drawCalls: fallback.count(), fallbackMeshes: fallback.count(), meshes: sources.size
    };
    let visibleMeshes = 0;
    for (const state of sources.values())
      if (state.slice && buildingShadowHasVisibleTriangles(state.slice)) visibleMeshes++;
    const positionCount = batchGeometry.getAttribute("position").count;
    const indexCount = batchGeometry.getIndex()?.count ?? 0;
    return {
      batchedMeshes: sources.size,
      bytes: positionCount * 3 * 4 + indexCount * 4,
      drawCalls: Number(batchMesh?.visible ?? false) + fallback.count(),
      fallbackMeshes: fallback.count(),
      meshes: sources.size,
      triangles: indexCount / 3,
      vertices: positionCount,
      visibleMeshes
    };
  };

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      disposeBatch();
      fallback.dispose();
      sources.clear();
      root.removeFromParent();
    },
    getStats,
    update
  };
};
