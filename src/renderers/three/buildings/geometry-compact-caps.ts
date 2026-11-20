import { type BufferGeometry, CircleGeometry, CylinderGeometry } from "three";

/** A flat regular cap needs n−2 triangles, not an n-triangle fan with repeated centre vertices.
 * Keep every original rim vertex/UV/normal: the exact polygon, closed volume and shading stay intact.
 */
export const compactPrimitiveCaps = (geometry: BufferGeometry) => {
  const index = geometry.index;
  if (!index) return geometry;
  if (geometry instanceof CircleGeometry && Math.abs(geometry.parameters.thetaLength - Math.PI * 2) < 1e-8) {
    const rim = Array.from({ length: geometry.parameters.segments }, (_, vertex) => vertex + 1);
    const indices: number[] = [];
    for (let vertex = 1; vertex < rim.length - 1; vertex++) indices.push(rim[0]!, rim[vertex]!, rim[vertex + 1]!);
    geometry.setIndex(indices);
    return geometry;
  }
  if (!(geometry instanceof CylinderGeometry) || Math.abs(geometry.parameters.thetaLength - Math.PI * 2) > 1e-8)
    return geometry;
  const indices: number[] = [], groups = geometry.groups.map(group => ({ ...group }));
  geometry.clearGroups();
  for (const group of groups) {
    const start = indices.length;
    if (group.materialIndex === 0) {
      for (let offset = group.start; offset < group.start + group.count; offset++) indices.push(index.getX(offset));
    } else {
      const rim = Array.from({ length: group.count / 3 }, (_, vertex) => index.getX(group.start + vertex * 3));
      if (group.materialIndex === 2) rim.reverse();
      for (let vertex = 1; vertex < rim.length - 1; vertex++) indices.push(rim[0]!, rim[vertex]!, rim[vertex + 1]!);
    }
    geometry.addGroup(start, indices.length - start, group.materialIndex);
  }
  geometry.setIndex(indices);
  return geometry;
};
