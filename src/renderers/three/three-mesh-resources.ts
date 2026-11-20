import { type Material, Mesh, type Object3D } from "three";

/** The materials of a mesh as a list (a mesh holds one material or an array of them). */
export const meshMaterials = (mesh: { material: Material | Material[] }): Material[] =>
  Array.isArray(mesh.material) ? mesh.material : [mesh.material];

/** Disposes the geometry of every mesh under `root` (materials and textures stay with their owner). */
export const disposeMeshGeometries = (root: Object3D) => {
  root.traverse(object => { if (object instanceof Mesh) object.geometry.dispose(); });
};
