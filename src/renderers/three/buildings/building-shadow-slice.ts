import {
  Box3,
  type BufferAttribute,
  type BufferGeometry,
  type Matrix4,
  Vector3
} from "three";

const transformedPoint = new Vector3();

/** An offscreen animated caster may go many frames without an upload clearing these ranges. */
const markUpdateRange = (attribute: BufferAttribute, start: number, count: number) => {
  let end = start + count;
  for (let index = 0; index < attribute.updateRanges.length;) {
    const range = attribute.updateRanges[index]!;
    if (range.start > end || range.start + range.count < start) {
      index++;
      continue;
    }
    start = Math.min(start, range.start);
    end = Math.max(end, range.start + range.count);
    attribute.updateRanges.splice(index, 1);
    index = 0;
  }
  attribute.addUpdateRange(start, end - start);
  attribute.needsUpdate = true;
};

export type BuildingShadowSlice = {
  bounds: Box3;
  drawCount: number;
  drawStart: number;
  index: BufferAttribute | null;
  indexOffset: number;
  indexVersion: number;
  mirrored: boolean;
  position: BufferAttribute;
  positionVersion: number;
  triangleCount: number;
  vertexCount: number;
  vertexOffset: number;
  visible: boolean;
};

export const buildingShadowTriangleCount = (geometry: BufferGeometry) => {
  const index = geometry.getIndex();
  return Math.floor((index?.count ?? geometry.getAttribute("position")?.count ?? 0) / 3);
};

const effectiveDrawEnd = (slice: BuildingShadowSlice) => {
  const length = slice.index?.count ?? slice.position.count;
  return Math.min(length, slice.drawStart + slice.drawCount);
};

export const buildingShadowHasVisibleTriangles = (slice: BuildingShadowSlice) => {
  if (!slice.visible || slice.drawCount <= 0 || slice.triangleCount <= 0) return false;
  return slice.drawStart < effectiveDrawEnd(slice);
};

/** Writes one source mesh into its stable root-local vertex slice. */
export const writeBuildingShadowPositions = (
  slice: BuildingShadowSlice,
  positions: BufferAttribute,
  matrix: Matrix4
) => {
  const elements = matrix.elements;
  const bounds = slice.bounds.makeEmpty();
  for (let vertex = 0; vertex < slice.vertexCount; vertex++) {
    const source = slice.vertexOffset + vertex;
    const x = slice.position.getX(vertex);
    const y = slice.position.getY(vertex);
    const z = slice.position.getZ(vertex);
    const transformedX = elements[0]! * x + elements[4]! * y + elements[8]! * z + elements[12]!;
    const transformedY = elements[1]! * x + elements[5]! * y + elements[9]! * z + elements[13]!;
    const transformedZ = elements[2]! * x + elements[6]! * y + elements[10]! * z + elements[14]!;
    positions.setXYZ(source, transformedX, transformedY, transformedZ);
    bounds.expandByPoint(transformedPoint.set(transformedX, transformedY, transformedZ));
  }
  markUpdateRange(positions, slice.vertexOffset * 3, slice.vertexCount * 3);
};

const writeTriangle = (
  slice: BuildingShadowSlice,
  target: Uint32Array,
  triangle: number,
  visibleTriangles: number
) => {
  const targetStart = slice.indexOffset + triangle * 3;
  if (triangle >= visibleTriangles) {
    target[targetStart] = 0;
    target[targetStart + 1] = 0;
    target[targetStart + 2] = 0;
    return;
  }
  const sourceStart = slice.drawStart + triangle * 3;
  const first = slice.index
    ? slice.index.getX(sourceStart) + slice.vertexOffset
    : slice.vertexOffset + sourceStart;
  const second = slice.index
    ? slice.index.getX(sourceStart + 1) + slice.vertexOffset
    : slice.vertexOffset + sourceStart + 1;
  const third = slice.index
    ? slice.index.getX(sourceStart + 2) + slice.vertexOffset
    : slice.vertexOffset + sourceStart + 2;
  target[targetStart] = slice.mirrored ? third : first;
  target[targetStart + 1] = second;
  target[targetStart + 2] = slice.mirrored ? first : third;
};

/** Hidden slices become degenerate triangles, so the whole building remains one draw. */
export const writeBuildingShadowIndices = (
  slice: BuildingShadowSlice,
  indices: BufferAttribute
) => {
  const target = indices.array as Uint32Array;
  const drawEnd = effectiveDrawEnd(slice);
  const visibleTriangles = slice.visible
    ? Math.max(0, Math.floor((drawEnd - slice.drawStart) / 3))
    : 0;
  for (let triangle = 0; triangle < slice.triangleCount; triangle++)
    writeTriangle(slice, target, triangle, visibleTriangles);
  markUpdateRange(indices, slice.indexOffset, slice.triangleCount * 3);
  slice.indexVersion = slice.index?.version ?? 0;
};
