import { createIslandTreePropMesh } from "../island-trees";
import type { PropMesh } from "../mesh-builder";

/** Keep the original temperate skeleton and bark; deterministic sparse crowns reveal its branches. */
export const createSparseSwampTree = (kind: number, variant: number, seed: number): PropMesh => {
  const original = createIslandTreePropMesh(kind, variant, seed);
  const indices: number[] = [];
  let coreIndexCount = 0;
  for (let index = 0; index < original.indices.length; index += 3) {
    const vertex = original.indices[index]!;
    const leaf = original.uvs[vertex * 2]! >= 0;
    // Both triangles of a leaf card make the same choice; one form in three is almost bare.
    const card = Math.floor(vertex / 4), hash = (Math.imul(card + 1, 2654435761) ^ seed) >>> 0;
    if (leaf && hash % (variant % 3 === 0 ? 20 : 5) !== 0) continue;
    indices.push(original.indices[index]!, original.indices[index + 1]!, original.indices[index + 2]!);
    if (index < (original.coreIndexCount ?? original.indices.length)) coreIndexCount += 3;
  }
  const used = [...new Set(indices)], remap = new Map(used.map((vertex, index) => [vertex, index]));
  const copy = (source: Float32Array, width: number) => Float32Array.from(used.flatMap(vertex =>
    Array.from(source.subarray(vertex * width, (vertex + 1) * width))));
  const positions = copy(original.positions, 3);
  let height = .01, radius = .01;
  for (let index = 0; index < positions.length; index += 3) {
    height = Math.max(height, positions[index + 1]!);
    radius = Math.max(radius, Math.hypot(positions[index]!, positions[index + 2]!));
  }
  return { ...original, colors: copy(original.colors, 3), coreIndexCount,
    height, indices: Uint16Array.from(indices, vertex => remap.get(vertex)!), normals: copy(original.normals, 3),
    positions, radius, uvs: copy(original.uvs, 2), wind: copy(original.wind, 2) };
};
