import { BufferAttribute, BufferGeometry } from "three";

import { createChineseLanternMesh } from "../../../render-common/props/chinese-lantern";

/** HQ and future independent placements use the same mesh, normalized without changing its proportions. */
export const createChineseLanternGeometry = (detailed: boolean, inscription?: number) => {
  const mesh = createChineseLanternMesh(detailed, inscription), geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(mesh.positions.slice(), 3));
  geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("color", new BufferAttribute(mesh.colors, 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(mesh.uvs.length).fill(.5), 2));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  return geometry.translate(0, -.5, 0).scale(1 / .655, 1, 1 / .655);
};
