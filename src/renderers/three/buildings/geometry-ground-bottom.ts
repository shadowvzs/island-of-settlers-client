import type { BufferGeometry } from "three";

/** Preserve every visible vertex/UV/normal, removing only an explicitly buried box's downward cap. */
export const omitGroundBottom = (geometry: BufferGeometry) => {
  const index = geometry.index, normals = geometry.getAttribute("normal");
  if (!index || !normals) return geometry;
  const indices: number[] = [], groups = geometry.groups.map(group => ({ ...group }));
  geometry.clearGroups();
  for (const group of groups) {
    const start = indices.length;
    for (let at = group.start; at < group.start + group.count; at += 3) {
      const vertices = [index.getX(at), index.getX(at + 1), index.getX(at + 2)];
      if (vertices.every(vertex => normals.getY(vertex) < -.999)) continue;
      indices.push(...vertices);
    }
    if (indices.length > start) geometry.addGroup(start, indices.length - start, group.materialIndex);
  }
  geometry.setIndex(indices);
  return geometry;
};
