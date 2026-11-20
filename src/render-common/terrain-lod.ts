import type { ChunkVertexData } from "./terrain-chunks";

const HEIGHT_ERROR = 0.015;
const ATTRIBUTE_ERROR = 6;
/** Horizontal offset (cells) beyond which a vertex counts as moved off its grid point. */
const GRID_ERROR = 1e-4;

/**
 * Whether a patch vertex sits where the patch corners' grid puts it: upright rock faces
 * (rocks/face-upright.ts) move vertices horizontally, and merging them would drop that shape.
 */
const isOnPatchGrid = (data: ChunkVertexData, patch: { depth: number; first: number; stride: number;
  width: number }, x: number, z: number) => {
  const { depth, first, stride, width } = patch;
  const corners = [first, first + width, first + depth * stride, first + depth * stride + width];
  const u = x / width, v = z / depth, vertex = first + z * stride + x;
  for (const axis of [0, 2]) {
    const [a, b, c, d] = corners.map(corner => data.positions[corner * 3 + axis]!);
    const expected = (a! * (1 - u) + b! * u) * (1 - v) + (c! * (1 - u) + d! * u) * v;
    if (Math.abs(data.positions[vertex * 3 + axis]! - expected) > GRID_ERROR) return false;
  }
  return true;
};

/** Interpolation on the actual centre-to-perimeter fan, rather than a bilinear patch. */
const fanSample = (
  first: number,
  width: number,
  depth: number,
  stride: number,
  x: number,
  z: number
) => {
  const halfX = width / 2,
    halfZ = depth / 2;
  const dx = x - halfX,
    dz = z - halfZ;
  const radius = Math.max(Math.abs(dx) / halfX, Math.abs(dz) / halfZ);
  const centre = first + halfZ * stride + halfX;
  if (!radius) return { a: centre, b: centre, centre, fraction: 0, outward: 0 };
  const horizontal = Math.abs(dx) / halfX >= Math.abs(dz) / halfZ;
  const along = horizontal ? halfZ + dz / radius : halfX + dx / radius;
  const edgeLength = horizontal ? depth : width;
  const cell = Math.min(edgeLength - 1, Math.floor(along));
  const a = horizontal
    ? first + cell * stride + (dx > 0 ? width : 0)
    : first + (dz > 0 ? depth * stride : 0) + cell;
  return { a, b: a + (horizontal ? stride : 1), centre, fraction: along - cell, outward: radius };
};

const canMerge = (
  data: ChunkVertexData,
  first: number,
  width: number,
  depth: number,
  stride: number
) => {
  const attributes = [data.splatA, data.splatB, data.splatC, data.shading, data.surface, data.theme, data.variant,
    data.litter];
  for (let z = 1; z < depth; z++)
    for (let x = 1; x < width; x++) {
      const vertex = first + z * stride + x;
      if (!isOnPatchGrid(data, { depth, first, stride, width }, x, z)) return false;
      const { a, b, centre, fraction, outward } = fanSample(first, width, depth, stride, x, z);
      const wa = outward * (1 - fraction),
        wb = outward * fraction,
        wc = 1 - outward;
      const height =
        data.positions[a * 3 + 1]! * wa +
        data.positions[b * 3 + 1]! * wb +
        data.positions[centre * 3 + 1]! * wc;
      if (Math.abs(height - data.positions[vertex * 3 + 1]!) > HEIGHT_ERROR) return false;
      for (const attribute of attributes)
        for (let channel = 0; channel < 4; channel++) {
          const value =
            attribute[a * 4 + channel]! * wa +
            attribute[b * 4 + channel]! * wb +
            attribute[centre * 4 + channel]! * wc;
          if (Math.abs(value - attribute[vertex * 4 + channel]!) > ATTRIBUTE_ERROR) return false;
        }
    }
  return true;
};

const appendFan = (
  indices: number[],
  first: number,
  width: number,
  depth: number,
  stride: number
) => {
  const ring: number[] = [];
  for (let i = 0; i < depth; i++) ring.push(first + i * stride);
  for (let i = 0; i < width; i++) ring.push(first + depth * stride + i);
  for (let i = 0; i < depth; i++) ring.push(first + depth * stride + width - i * stride);
  for (let i = 0; i < width; i++) ring.push(first + width - i);
  const centre = first + (depth / 2) * stride + width / 2;
  for (let i = 0; i < ring.length; i++)
    indices.push(centre, ring[i]!, ring[(i + 1) % ring.length]!);
};

/** Adaptive square/rectangular planar interiors. Every outer and patch edge retains all original vertices,
 * so neighbouring chunks and detail levels meet exactly. Water remains at full resolution.
 */
/** Vertices per row: the chunk's own count, or (older data without it) the first row's length. */
const getRowStride = (data: ChunkVertexData) => {
  if (data.columns !== undefined) return data.columns + 1;
  const originZ = data.positions[2]!;
  let stride = 1;
  while (stride < data.vertexCount && data.positions[stride * 3 + 2] === originZ) stride++;
  return stride;
};

export const buildTerrainLodIndices = (data: ChunkVertexData) => {
  const stride = getRowStride(data);
  const columns = stride - 1,
    rows = data.vertexCount / stride - 1;
  if (!Number.isInteger(rows) || columns < 6 || rows < 6) return data.indices;
  const consumed = new Uint8Array(columns * rows),
    additions: number[] = [];
  // Rectangles recover narrow planar strips rejected by larger square patches.
  for (const [width, depth, step] of [
    [8, 8, 4],
    [4, 4, 4],
    [4, 2, 2],
    [2, 4, 2]
  ] as const)
    for (let z = 1; z + depth < rows; z += step)
      for (let x = 1; x + width < columns; x += step) {
        if (consumed[z * columns + x] || !canMerge(data, z * stride + x, width, depth, stride))
          continue;
        let overlaps = false;
        for (let dz = 0; dz < depth && !overlaps; dz++)
          for (let dx = 0; dx < width; dx++)
            if (consumed[(z + dz) * columns + x + dx]) {
              overlaps = true;
              break;
            }
        if (overlaps) continue;
        for (let dz = 0; dz < depth; dz++)
          consumed.fill(1, (z + dz) * columns + x, (z + dz) * columns + x + width);
        appendFan(additions, z * stride + x, width, depth, stride);
      }
  if (!additions.length) return data.indices;
  const retained: number[] = [];
  for (let offset = 0; offset < data.indices.length; offset += 3) {
    const a = data.indices[offset]!,
      b = data.indices[offset + 1]!,
      c = data.indices[offset + 2]!;
    const x = Math.min(a % stride, b % stride, c % stride);
    const z = Math.floor(Math.min(a, b, c) / stride);
    if (!consumed[z * columns + x]) retained.push(a, b, c);
  }
  return Uint16Array.from([...retained, ...additions]);
};
