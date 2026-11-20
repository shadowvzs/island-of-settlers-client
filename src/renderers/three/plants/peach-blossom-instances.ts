import {
  BufferGeometry, Group, InstancedMesh, MeshStandardMaterial, Object3D
} from "three";

import type { OrnamentalBlossom } from "../../../render-common/plants/ornamental-tree-graph";

export type PeachBlossomSurface = "calyx" | "centre" | "petals";
export type PeachBlossomGeometries = Record<PeachBlossomSurface, BufferGeometry>;
export type PeachBlossomMaterials = Record<PeachBlossomSurface, MeshStandardMaterial>;

/** Caller-owned canonical blossom buffers/materials are shared by every attached flower and palette. */
export const createPeachBlossomInstances = (flowers: readonly OrnamentalBlossom[],
  geometries: PeachBlossomGeometries, materials: PeachBlossomMaterials, detailed: boolean) => {
  const root = new Group(); root.name = "canonical-peach-blossoms";
  const meshes: InstancedMesh[] = [], counts: Record<PeachBlossomSurface, number> = {
    calyx: 0, centre: 0, petals: 0
  };
  const surfaces: PeachBlossomSurface[] = ["calyx", "centre", "petals"];
  for (const surface of surfaces) {
    const geometry = geometries[surface];
    const mesh = new InstancedMesh(geometry, materials[surface], flowers.length);
    mesh.name = `peach-${surface}`; mesh.castShadow = detailed; mesh.receiveShadow = detailed;
    const vertices = geometry.index?.count ?? geometry.getAttribute("position").count;
    counts[surface] = vertices / 3 * flowers.length;
    meshes.push(mesh); root.add(mesh);
  }
  const transform = new Object3D();
  flowers.forEach((flower, index) => {
    transform.position.set(...flower.position); transform.rotation.set(flower.pitch, flower.yaw, 0, "YXZ");
    transform.scale.setScalar(flower.radius); transform.updateMatrix();
    meshes.forEach(mesh => mesh.setMatrixAt(index, transform.matrix));
  });
  meshes.forEach(mesh => {
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere();
  });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; root.removeFromParent(); root.clear();
    // InstancedMesh owns instance buffers; the template retains geometry/maps/material ownership.
    meshes.forEach(mesh => mesh.dispose());
  };
  return { root, counts, triangles: Object.values(counts).reduce((sum, count) => sum + count, 0), dispose };
};
