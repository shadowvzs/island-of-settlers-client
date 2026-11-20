import {
  BoxGeometry,   type BufferGeometry, CylinderGeometry, Mesh, type MeshStandardMaterial,
TorusGeometry} from "three";

/** Shared functional-looking helm, baked into ship material batches (figureheads: ship-figureheads.ts). */
export const createShipOrnamentParts = (
  detailed: boolean, own: (geometry: BufferGeometry) => BufferGeometry,
  materials: { bronze: MeshStandardMaterial; wood: MeshStandardMaterial }
) => {
  const parts: Mesh[] = [];
  const pole = own(new CylinderGeometry(1, 1, 1, detailed ? 8 : 5));
  const ring = own(new TorusGeometry(1, .08, detailed ? 8 : 3, detailed ? 32 : 12));
  const box = own(new BoxGeometry(1, 1, 1));
  const add = (name: string, geometry: BufferGeometry, material: MeshStandardMaterial,
    position: [number, number, number], scale: [number, number, number]) => {
    const mesh = new Mesh(geometry, material);
    mesh.name = name; mesh.position.set(...position); mesh.scale.set(...scale);
    parts.push(mesh); return mesh;
  };
  // Eight spokes, continuous wooden rim, brass hub and distinct hand grips on a mounted shaft.
  add("helm_pedestal", box, materials.wood, [0, .436, -.932], [.036, .15, .045]);
  const axle = add("helm_axle", pole, materials.bronze, [0, .49, -.915], [.013, .064, .013]);
  axle.rotation.x = Math.PI / 2;
  add("helm_rim", ring, materials.wood, [0, .49, -.884], [.066, .066, .066]);
  if (detailed) add("helm_brass_rim", ring, materials.bronze, [0, .49, -.878], [.059, .059, .059]);
  const hub = add("helm_hub", pole, materials.bronze, [0, .49, -.884], [.013, .02, .013]);
  hub.rotation.x = Math.PI / 2;
  for (let index = 0; index < 8; index++) {
    const angle = index * Math.PI / 4, dx = Math.sin(angle), dy = Math.cos(angle);
    const spoke = add("helm_spoke", pole, materials.wood,
      [dx * .034, .49 + dy * .034, -.884], [.004, .063, .004]);
    spoke.rotation.z = -angle;
    const grip = add("helm_hand_grip", pole, materials.wood,
      [dx * .08, .49 + dy * .08, -.884], [.006, .024, .006]);
    grip.rotation.z = -angle;
  }
  return parts;
};
