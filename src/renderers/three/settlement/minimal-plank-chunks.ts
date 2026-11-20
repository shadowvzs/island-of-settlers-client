import type { AdvancedAssetChunk } from "./advanced-material-assets";

/**
 * Minimal keeps staggered ends, outer board faces and binding straps. The fine inner-gap
 * shading is omitted, retaining the native bundle's full silhouette and measured envelope.
 */
export const minimalPlankChunks = (chunks: readonly AdvancedAssetChunk[]): readonly AdvancedAssetChunk[] => {
  const boards = chunks.filter(chunk => chunk.material === 0);
  const minimum = [Infinity, Infinity], maximum = [-Infinity, -Infinity];
  for (const board of boards) for (let at = 0; at < board.position.length; at += 3)
    for (let axis = 0; axis < 2; axis++) {
      minimum[axis] = Math.min(minimum[axis]!, board.position[at + axis]!);
      maximum[axis] = Math.max(maximum[axis]!, board.position[at + axis]!);
    }
  return chunks.map(chunk => {
    if (chunk.material !== 0) return chunk;
    const position: number[] = [], uv: number[] = [];
    for (let at = 0; at < chunk.position.length; at += 9) {
      const inward = [0, 1].some(axis => {
        const plane = chunk.position[at + axis]!;
        return Math.abs(plane - chunk.position[at + 3 + axis]!) < 1e-6 &&
          Math.abs(plane - chunk.position[at + 6 + axis]!) < 1e-6 &&
          plane > minimum[axis]! + 1e-6 && plane < maximum[axis]! - 1e-6;
      });
      if (inward) continue;
      position.push(...chunk.position.slice(at, at + 9));
      uv.push(...chunk.uv.slice(at / 3 * 2, at / 3 * 2 + 6));
    }
    return { ...chunk, minimalPosition: position, minimalUv: uv };
  });
};
