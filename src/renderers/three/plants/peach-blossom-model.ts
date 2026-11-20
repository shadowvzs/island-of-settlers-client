import { Group, Mesh } from "three";

import type { OrnamentalBlossom } from "../../../render-common/plants/ornamental-tree-graph";
import { createPeachBlossomGeometries } from "./peach-blossom-geometry";
import type { PeachBlossomMaterials } from "./peach-blossom-materials";

/** Independent flower model with three shared surface batches; material lifetime belongs to the caller. */
export const createPeachBlossomModel = (flower: OrnamentalBlossom, detailed: boolean,
  materials: PeachBlossomMaterials,
  borrowedGeometries?: ReturnType<typeof createPeachBlossomGeometries>) => {
  const root = new Group(); root.name = "peach-blossom";
  const geometries = borrowedGeometries ?? createPeachBlossomGeometries({
    position: [0, 0, 0], yaw: 0, pitch: 0, radius: 1, seed: flower.seed
  }, detailed);
  root.position.set(...flower.position); root.rotation.set(flower.pitch, flower.yaw, 0, "YXZ");
  root.scale.setScalar(flower.radius);
  const counts = { petals: 0, calyx: 0, centre: 0 };
  for (const key of Object.keys(geometries) as (keyof typeof geometries)[]) {
    const geometry = geometries[key];
    const mesh = new Mesh(geometry, materials[key]); mesh.name = `peach-blossom-${key}`;
    mesh.castShadow = detailed; root.add(mesh);
    counts[key] = geometry.index!.count / 3;
  }
  let disposed = false;
  return { root, counts, triangles: Object.values(counts).reduce((sum, value) => sum + value, 0), dispose: () => {
    if (disposed) return;
    disposed = true; root.removeFromParent(); root.clear();
    if (!borrowedGeometries) Object.values(geometries).forEach(geometry => geometry.dispose());
  } };
};
