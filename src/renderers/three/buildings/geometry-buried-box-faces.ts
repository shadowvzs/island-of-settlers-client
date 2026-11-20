import type { BufferGeometry } from "three";

import type { BuriedBoxFace } from "../../../render-common/buildings/buried-box-face";

/** Preserve all position/UV/normal data, removing only explicitly proven hidden box caps. */
export const omitBuriedBoxFaces = (geometry: BufferGeometry, faces: readonly BuriedBoxFace[]) => {
  const index = geometry.index, normals = geometry.getAttribute("normal");
  if (!index || !normals || !faces.length) return geometry;
  const component = (vertex: number, axis: string) => {
    if (axis === "x") return normals.getX(vertex);
    if (axis === "y") return normals.getY(vertex);
    return normals.getZ(vertex);
  };
  const indices: number[] = [], groups = geometry.groups.map(group => ({ ...group }));
  geometry.clearGroups();
  for (const group of groups) {
    const start = indices.length;
    for (let at = group.start; at < group.start + group.count; at += 3) {
      const vertices = [index.getX(at), index.getX(at + 1), index.getX(at + 2)];
      if (faces.some(face => vertices.every(vertex =>
        component(vertex, face[1]!) * (face[0] === "-" ? -1 : 1) > .999))) continue;
      indices.push(...vertices);
    }
    if (indices.length > start) geometry.addGroup(start, indices.length - start, group.materialIndex);
  }
  geometry.setIndex(indices);
  return geometry;
};
