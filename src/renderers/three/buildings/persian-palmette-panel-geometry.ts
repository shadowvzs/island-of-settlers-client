import { BufferAttribute, BufferGeometry } from "three";

import { createPersianPalmettePanel } from "../../../render-common/props/persian-palmette-panel";

export const createPersianPalmettePanelGeometry = (detailed: boolean) => {
  const mesh = createPersianPalmettePanel(detailed), geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("color", new BufferAttribute(mesh.colors, 3));
  geometry.setAttribute("uv", new BufferAttribute(mesh.uvs, 2));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  geometry.translate(0, 0, .15); geometry.scale(1, 1, 1 / .7);
  geometry.computeBoundingBox();
  return geometry;
};
