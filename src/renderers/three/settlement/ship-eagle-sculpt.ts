import { BufferGeometry, Float32BufferAttribute, Mesh, type MeshStandardMaterial } from "three";

import { SHIP_EAGLE_SCULPTURE } from "../../../render-common/ships/eagle-sculpture-data";

/** Owner-supplied Eagle Sculpture by jerryfisher (CC-BY-4.0), offline simplified
 * from 200k triangles. No procedural anatomical stand-in is used at runtime. */
export const createShipEagleSculpt = (
  detailed: boolean, own: (geometry: BufferGeometry) => BufferGeometry,
  gold: MeshStandardMaterial, _dark: MeshStandardMaterial
) => {
  const data = detailed ? SHIP_EAGLE_SCULPTURE.high : SHIP_EAGLE_SCULPTURE.minimal;
  const geometry = own(new BufferGeometry());
  geometry.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(Array(data.positions.length / 3 * 2).fill(0), 2));
  geometry.setAttribute("normal", new Float32BufferAttribute(data.normals, 3));
  geometry.setIndex(data.indices);
  const mesh = new Mesh(geometry, gold); mesh.name = "eagle_sculpture_jerryfisher";
  return [mesh];
};
