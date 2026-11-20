import { BufferAttribute, BufferGeometry } from "three";

import { createMayaCivicMask } from "../../../render-common/props/maya-civic-mask";

export const createMayaCivicMaskGeometry = (detailed: boolean,compact=false) => {
  const mesh = createMayaCivicMask(detailed,compact), geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("color", new BufferAttribute(mesh.colors, 3));
  geometry.setAttribute("uv", new BufferAttribute(mesh.uvs, 2));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};
