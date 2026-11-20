import {
  BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, type MeshStandardMaterial, PlaneGeometry
} from "three";

import type { BuildingSurface, Point3 } from "../../../render-common/buildings/building-recipe";
import { DEFAULT_ROMAN_DOOR } from "../../../render-common/buildings/roman-door-profile";

/** A top-attached textile flap lifts into folds beneath its lintel. */
export const createTentDoor = (materials: Record<BuildingSurface, MeshStandardMaterial>, detailed: boolean,
  position: Point3, dimensions = DEFAULT_ROMAN_DOOR, prefix = "tent") => {
  const root = new Group(); root.name = "door"; root.position.set(...position);
  root.userData.profile = "textile";
  const height = Math.max(dimensions.height, dimensions.spring + dimensions.width / 2) + .045;
  // The lodge's opening includes .1 of approach clearance on each side. Overlap that cutout
  // instead of leaving the interior visible beside the closed fabric.
  const overlap = .11;
  const width = dimensions.width + overlap * 2;
  const fabric = materials.cloth.clone(); fabric.side = DoubleSide;
  const pivot = new Group(); pivot.name = `${prefix}_flap`; pivot.position.z = .018;
  root.userData.tentFabric = `${prefix}_fabric`;
  const geometry = new PlaneGeometry(width, height, detailed ? 20 : 6, detailed ? 16 : 4);
  const vertices = geometry.getAttribute("position");
  geometry.setAttribute("color", new Float32BufferAttribute(new Float32Array(vertices.count * 3).fill(1), 3));
  for (let index = 0; index < vertices.count; index++) {
    const x = vertices.getX(index), y = vertices.getY(index);
    const down = .5 - y / height;
    vertices.setXYZ(index, x + width / 2 - overlap, y + height / 2,
      Math.sin(x / width * Math.PI * 12) * .009 * down + down * down * .012);
  }
  geometry.computeVertexNormals();
  const gathered = vertices.clone(), folds = detailed ? 6 : 2;
  for (let index = 0; index < vertices.count; index++) {
    const across = (vertices.getX(index) + overlap) / width, up = vertices.getY(index) / height;
    // Keep the sewn top edge fixed. Lower rows fold outward and upward, rather than sliding
    // sideways like a rigid mechanical shutter. The raised hem clears the worker corridor.
    gathered.setXYZ(index, vertices.getX(index), height - (1 - up) * .025,
      Math.sin(up * Math.PI * folds * 2) * .025 * (1 - up)
        + Math.sin(up * Math.PI) * (.035 + Math.sin(across * Math.PI) * .018));
  }
  geometry.morphAttributes.position = [gathered];
  const foldedGeometry = new BufferGeometry();
  foldedGeometry.setAttribute("position", gathered.clone());
  foldedGeometry.setIndex(geometry.index!.clone()); foldedGeometry.computeVertexNormals();
  geometry.morphAttributes.normal = [foldedGeometry.getAttribute("normal").clone()];
  foldedGeometry.dispose();
  const flap = new Mesh(geometry, fabric); flap.name = `${prefix}_fabric`;
  flap.castShadow = detailed; flap.receiveShadow = detailed; flap.userData.ownedMaterial = true;
  pivot.add(flap); root.add(pivot);
  return root;
};

export const updateTentDoor = (root: Group, opening: number) => {
  root.rotation.y = 0;
  const fabric = root.getObjectByName(root.userData.tentFabric);
  if (fabric instanceof Mesh && fabric.morphTargetInfluences)
    fabric.morphTargetInfluences[0] = Math.max(0, Math.min(1, opening));
};
