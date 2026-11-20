import { BufferAttribute, BufferGeometry } from "three";

import { createPersianStuccoRelief } from "../../../render-common/props/persian-stucco-relief";

/** Original carved scrolls share one static geometry batch with their facade material. */
export const createPersianStuccoReliefGeometry = (detailed: boolean) => {
  const mesh = createPersianStuccoRelief(detailed), geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("color", new BufferAttribute(mesh.colors, 3));
  geometry.setAttribute("uv", new BufferAttribute(Float32Array.from(mesh.uvs, () => .5), 2));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1)); geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  geometry.translate(-(bounds.min.x + bounds.max.x) / 2, -(bounds.min.y + bounds.max.y) / 2,
    -(bounds.min.z + bounds.max.z) / 2);
  geometry.scale(1 / (bounds.max.x - bounds.min.x), 1 / (bounds.max.y - bounds.min.y),
    1 / (bounds.max.z - bounds.min.z));
  return geometry;
};
