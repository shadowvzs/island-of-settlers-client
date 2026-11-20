import { BufferAttribute, BufferGeometry, Vector3 } from "three";

import { createNurserySaplingMesh } from "../../../render-common/props/nursery-sapling";
import { createWorkshopStumpMesh } from "../../../render-common/props/stump-meshes";

/** Original world meshes with explicit leaf contours; no sphere canopies or block tool substitutes. */
export const createWorkshopPropGeometry = (kind: "stump" | "sapling", detailed: boolean) => {
  const mesh = kind === "stump" ? createWorkshopStumpMesh() : createNurserySaplingMesh(detailed);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(mesh.positions.slice(), 3));
  geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  const colours = mesh.colors.slice();
  for (let vertex = 0; vertex < mesh.positions.length / 3; vertex++) {
    if (kind !== "sapling" || mesh.uvs[vertex * 2]! < 0) continue;
    colours[vertex * 3] = colours[vertex * 3]! * .15;
    colours[vertex * 3 + 1] = colours[vertex * 3 + 1]! * .3;
    colours[vertex * 3 + 2] = colours[vertex * 3 + 2]! * .12;
  }
  geometry.setAttribute("color", new BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(mesh.uvs.length).fill(.5), 2));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!, size = bounds.getSize(new Vector3());
  const centre = bounds.getCenter(new Vector3());
  geometry.translate(-centre.x, -centre.y, -centre.z);
  geometry.scale(1 / size.x, 1 / size.y, 1 / size.z);
  return geometry;
};
