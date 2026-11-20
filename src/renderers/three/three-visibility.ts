import { Box3, type Camera,Frustum, Matrix4, Vector3 } from "three";

import type { CellRegion } from "../../shared/world/grid-geometry";

/** Culling granularity for instanced props (cells). */
export const CULL_CHUNK_CELLS = 16;
const MARGIN = 3;
const MIN_Y = -6;
const MAX_Y = 12;

export const getCullChunk = (x: number, z: number, chunksX: number) =>
  Math.floor(z / CULL_CHUNK_CELLS) * chunksX + Math.floor(x / CULL_CHUNK_CELLS);

/** Culling chunks the region (cells) lies in. */
export const listCullChunks = (region: CellRegion, chunksX: number) => {
  const chunks = new Set<number>();
  for (
    let z = Math.floor(region.minZ / CULL_CHUNK_CELLS);
    z * CULL_CHUNK_CELLS <= region.maxZ;
    z += 1
  ) {
    for (
      let x = Math.floor(region.minX / CULL_CHUNK_CELLS);
      x * CULL_CHUNK_CELLS <= region.maxX;
      x += 1
    ) {
      chunks.add(z * chunksX + x);
    }
  }
  return chunks;
};

/**
 * Visible chunk mask from the camera frustum (with a margin, so shadows of trees just outside
 * the view still fall into it). `changed` tells callers when instance buffers need a rebuild.
 * A taller `maxY` box is used for shadow-caster visibility, where tree crowns reach above the
 * ordinary prop culling height.
 */
export const createChunkVisibility = (
  cellsX: number,
  cellsZ: number,
  { maxY = MAX_Y, minY = MIN_Y }: { maxY?: number; minY?: number } = {}
) => {
  const chunksX = Math.ceil(cellsX / CULL_CHUNK_CELLS);
  const chunksZ = Math.ceil(cellsZ / CULL_CHUNK_CELLS);
  const boxes = Array.from({ length: chunksX * chunksZ }, (_, chunk) => {
    const x = (chunk % chunksX) * CULL_CHUNK_CELLS;
    const z = Math.floor(chunk / chunksX) * CULL_CHUNK_CELLS;
    return new Box3(
      new Vector3(x - MARGIN, minY, z - MARGIN),
      new Vector3(x + CULL_CHUNK_CELLS + MARGIN, maxY, z + CULL_CHUNK_CELLS + MARGIN)
    );
  });
  const visible = new Uint8Array(boxes.length);
  const frustum = new Frustum();
  const matrix = new Matrix4();
  let signature = "";

  const applyFrustum = (next: Frustum) => {
    boxes.forEach((box, chunk) => {
      visible[chunk] = next.intersectsBox(box) ? 1 : 0;
    });
    const nextSignature = visible.join("");
    const changed = nextSignature !== signature;
    signature = nextSignature;
    return changed;
  };

  const update = (camera: Camera) => {
    camera.updateMatrixWorld();
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(matrix);
    return applyFrustum(frustum);
  };

  return { update, updateFrustum: applyFrustum, visible };
};

/**
 * Chunk mask for a spherical ground-distance limit around the eye. Hysteresis prevents instance
 * buffer churn while walking along a boundary; callers still combine it with the frustum mask.
 */
export const createDistanceVisibility = (
  cellsX: number,
  cellsZ: number,
  distance: number,
  hysteresis = 4
) => {
  const chunksX = Math.ceil(cellsX / CULL_CHUNK_CELLS);
  const chunksZ = Math.ceil(cellsZ / CULL_CHUNK_CELLS);
  const mask = new Uint8Array(chunksX * chunksZ);
  const centers = Array.from({ length: chunksX * chunksZ }, (_, chunk) => ({
    x: ((chunk % chunksX) + 0.5) * CULL_CHUNK_CELLS,
    z: (Math.floor(chunk / chunksX) + 0.5) * CULL_CHUNK_CELLS
  }));
  let signature = "";
  const update = (position: { x: number; z: number }) => {
    const enter = distance + hysteresis;
    const leave = Math.max(0, distance - hysteresis);
    for (let chunk = 0; chunk < centers.length; chunk += 1) {
      const center = centers[chunk]!;
      const squared = (center.x - position.x) ** 2 + (center.z - position.z) ** 2;
      mask[chunk] = squared <= (mask[chunk] ? enter : leave) ** 2 ? 1 : 0;
    }
    const next = mask.join("");
    const changed = next !== signature;
    signature = next;
    return changed;
  };
  return { mask, update };
};
