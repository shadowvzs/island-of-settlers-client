import type { ChunkVertexData } from "../terrain-chunks";

const winterChunks = new WeakMap<ChunkVertexData, ChunkVertexData>();

/** Cached presentation clone; canonical world and geometry arrays remain untouched. */
export const getWinterTerrainChunk = (source: ChunkVertexData): ChunkVertexData => {
  const cached = winterChunks.get(source);
  if (cached) return cached;
  const splatA = source.splatA.slice(), splatB = source.splatB.slice();
  for (let vertex = 0; vertex < source.vertexCount; vertex++) {
    const offset = vertex * 4, depth = source.water[offset]!;
    // Owner: exposed banks stay snow-white right to the waterline; submerged beds keep their material.
    if (depth > .015) continue;
    let capacity = 255 - splatB[offset + 2]!;
    for (const [weights, channel] of [[splatA, 0], [splatA, 1], [splatA, 2], [splatA, 3],
      [splatB, 0], [splatB, 3]] as const) {
      const transferred = Math.min(capacity, weights[offset + channel]!);
      weights[offset + channel]! -= transferred;
      splatB[offset + 2]! += transferred;
      capacity -= transferred;
    }
  }
  const result = { ...source, splatA, splatB };
  winterChunks.set(source, result);
  return result;
};

/** Call only if a caller replaces arrays on the same chunk object instead of making a new revision. */
export const invalidateWinterTerrainChunk = (source: ChunkVertexData) => winterChunks.delete(source);
