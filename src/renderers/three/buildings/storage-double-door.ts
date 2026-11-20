import { BoxGeometry, Float32BufferAttribute, Group, Mesh, type MeshStandardMaterial } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { BuildingSurface, Point3 } from "../../../render-common/buildings/building-recipe";
import type { RomanDoorDimensions } from "../../../render-common/buildings/roman-door-profile";
import { createRomanGroundDoor } from "./roman-door";

/** Each separately moving leaf keeps only one draw per material, including its fitted battens. */
const mergeLeaf = (leaf: Group) => {
  const surfaces = new Map<MeshStandardMaterial, Mesh[]>();
  for (const object of leaf.children) {
    if (!(object instanceof Mesh)) continue;
    const material = object.material as MeshStandardMaterial;
    const group = surfaces.get(material) ?? [];
    group.push(object); surfaces.set(material, group);
  }
  let surfaceIndex = 0;
  for (const [material, parts] of surfaces) {
    const mixedIndices = parts.some(part => !!part.geometry.index !== !!parts[0]!.geometry.index);
    const transformed = parts.map(part => {
      part.updateMatrix();
      if (mixedIndices && part.geometry.index)
        return part.geometry.toNonIndexed().applyMatrix4(part.matrix);
      return part.geometry.clone().applyMatrix4(part.matrix);
    });
    const geometry = mergeGeometries(transformed);
    transformed.forEach(part => part.dispose());
    if (!geometry) throw new Error("Incompatible double-door leaf material geometry");
    const mesh = new Mesh(geometry, material);
    mesh.name = `${leaf.name}_surface_${surfaceIndex++}`;
    mesh.castShadow = parts.some(part => part.castShadow);
    leaf.add(mesh);
    for (const part of parts) { leaf.remove(part); part.geometry.dispose(); }
  }
};

/** A nation-appropriate stretched textile panel bound to a slender timber leaf frame. */
const addDoorBox = (group: Group, materials: Record<BuildingSurface, MeshStandardMaterial>,
  detailed: boolean, surface: BuildingSurface, position: Point3, size: Point3) => {
  const geometry = new BoxGeometry(...size);
  geometry.setAttribute("color", new Float32BufferAttribute(
    new Float32Array(geometry.getAttribute("position").count * 3).fill(1), 3));
  const mesh = new Mesh(geometry, materials[surface]);
  mesh.position.set(...position); mesh.castShadow = detailed; group.add(mesh);
};

const createTextileLeaf = (materials: Record<BuildingSurface, MeshStandardMaterial>,
  detailed: boolean, width: number, height: number) => {
  const leaf = new Group();
  const box = (surface: BuildingSurface, position: Point3, size: Point3) =>
    addDoorBox(leaf, materials, detailed, surface, position, size);
  box("cloth", [width / 2, height / 2, 0], [width - .025, height - .025, .012]);
  for (const x of [.009, width - .009]) box("wood", [x, height / 2, 0], [.018, height, .025]);
  for (const y of [.009, height - .009]) box("wood", [width / 2, y, 0], [width, .018, .025]);
  return leaf;
};

/** Sew the oversized lodge portal to the real frame; closed leaves must not expose side/head slits. */
const createTextileSurround = (materials: Record<BuildingSurface, MeshStandardMaterial>,
  detailed: boolean, dimensions: RomanDoorDimensions) => {
  const root = new Group(); root.name = "door_textile_surround";
  const { height, width } = dimensions, overlap = .11;
  for (const x of [-overlap / 2, width + overlap / 2])
    addDoorBox(root, materials, detailed, "cloth", [x, height / 2, -.012], [overlap, height, .006]);
  addDoorBox(root, materials, detailed, "cloth", [width / 2, height + overlap / 2, -.012],
    [width + overlap * 2, overlap, .006]);
  mergeLeaf(root);
  return root;
};

export const createStorageDoubleDoor = (materials: Record<BuildingSurface, MeshStandardMaterial>,
  detailed: boolean, position: Point3, dimensions: RomanDoorDimensions, textile = false) => {
  const root = new Group(); root.name = "door"; root.position.set(...position);
  root.userData.profile = textile ? "textile-double" : "flat-double";
  const half = { ...dimensions, width: dimensions.width / 2 };
  for (const side of [0, 1]) {
    // A small meeting-edge overlap covers the bevel and floating-point cracks at the closed seam.
    const leafDimensions = side === 0 && !textile ? { ...half, width: half.width + .003 } : half;
    const group = textile ? createTextileLeaf(materials, detailed, half.width, half.height)
      : createRomanGroundDoor(materials, detailed, [0, 0, 0], false, leafDimensions);
    group.name = side === 0 ? "door_left" : "door_right";
    if (side === 1) { group.position.x = dimensions.width; group.scale.x = -1; }
    mergeLeaf(group); root.add(group);
  }
  if (textile) root.add(createTextileSurround(materials, detailed, dimensions));
  return root;
};

export const updateStorageDoubleDoor = (root: Group, openings: readonly [number, number]) => {
  root.rotation.y = 0;
  const left = root.getObjectByName("door_left"), right = root.getObjectByName("door_right");
  if (left) left.rotation.y = -Math.max(0, Math.min(1, openings[0])) * Math.PI / 2;
  if (right) right.rotation.y = Math.max(0, Math.min(1, openings[1])) * Math.PI / 2;
};
