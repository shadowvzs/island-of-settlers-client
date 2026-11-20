import { BufferGeometry, Group, Material, Mesh, MeshStandardMaterial, Texture } from "three";

import { meshMaterials } from "../three-mesh-resources";

/** Owns all resources of an offline icon model; frames its solid silhouette without the cast shadow. */
export const staticWareIcon = (root: Group) => {
  const geometries = new Set<BufferGeometry>(), materials = new Set<Material>(), textures = new Set<Texture>();
  let triangles = 0;
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    object.castShadow = object.receiveShadow = true;
    geometries.add(object.geometry);
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3;
    for (const material of meshMaterials(object)) {
      materials.add(material);
      if (material instanceof MeshStandardMaterial && material.map) textures.add(material.map);
    }
  });
  return { root, recipe: { tool: false, tightFraming: true, framingMargin: 1.07 }, triangles: () => triangles,
    dispose: () => {
      geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
      textures.forEach(texture => texture.dispose()); root.removeFromParent();
    } };
};
