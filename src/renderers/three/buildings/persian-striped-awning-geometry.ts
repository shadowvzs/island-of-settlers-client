import { BufferAttribute, BufferGeometry } from "three";

import type { BuildingPart } from "../../../render-common/buildings/building-recipe";
import { createPersianStripedAwning } from "../../../render-common/props/persian-striped-awning";

export const createPersianStripedAwningGeometry = (part: BuildingPart, detailed: boolean) => {
  const mesh = createPersianStripedAwning(detailed, part.persianAwningWall), geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("color", new BufferAttribute(mesh.colors, 3));
  geometry.setAttribute("uv", new BufferAttribute(mesh.uvs, 2));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1)); geometry.computeBoundingBox();
  return geometry;
};
