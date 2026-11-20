import { type BufferGeometry, Float32BufferAttribute } from "three";

/** Keep original upward or complementary faces of a room-bearing primitive; compact only unused vertices. */
export const keepInteriorFloorFaces = (geometry: BufferGeometry, faces: "top" | "sides") => {
  const index = geometry.index, normals = geometry.getAttribute("normal");
  if (!index || !normals) return geometry;
  const kept: number[] = [];
  const groups = geometry.groups.map(group => ({ ...group, kept: 0 }));
  for (let at = 0; at < index.count; at += 3) {
    const vertices = [index.getX(at), index.getX(at + 1), index.getX(at + 2)];
    const upward = vertices.every(vertex => normals.getY(vertex) > .999);
    if (upward === (faces === "top")) {
      kept.push(...vertices);
      const group = groups.find(candidate => at >= candidate.start && at < candidate.start + candidate.count);
      if (group) group.kept += 3;
    }
  }
  const sourceVertices = [...new Set(kept)], remap = new Map(sourceVertices.map((vertex, at) => [vertex, at]));
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const values = sourceVertices.flatMap(vertex => Array.from({ length: attribute.itemSize }, (_, component) =>
      attribute.getComponent(vertex, component)));
    geometry.setAttribute(name, new Float32BufferAttribute(values, attribute.itemSize, attribute.normalized));
  }
  geometry.clearGroups();
  let groupStart = 0;
  for (const group of groups) {
    if (group.kept) geometry.addGroup(groupStart, group.kept, group.materialIndex);
    groupStart += group.kept;
  }
  geometry.setIndex(kept.map(vertex => remap.get(vertex)!));
  geometry.boundingBox = null; geometry.boundingSphere = null;
  return geometry;
};
