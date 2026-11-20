import { Box3, Group, InstancedMesh, Matrix4, Mesh, type MeshStandardMaterial, Vector3 } from "three";

import { createCoinChestModel } from "./coin-chest-model";

export interface ChestPlacement { x: number; y: number; z: number }

/** One lazy closed original chest, shared by every vessel of this renderer owner. */
export const createCoinChestInstances = (detailed: boolean) => {
  let model: ReturnType<typeof createCoinChestModel> | undefined;
  const bounds = new Box3(), size = new Vector3();
  const source = () => {
    if (!model) {
      model = createCoinChestModel({ detailed, lid: "closed", units: 0 });
      bounds.setFromObject(model.root); bounds.getSize(size);
    }
    return model;
  };
  const create = (capacity: number, scale = 1, fading = false) => {
    const root = new Group(); root.name = "coin_cargo_chests";
    const meshes: InstancedMesh[] = [], ownedMaterials: MeshStandardMaterial[] = [];
    const matrix = new Matrix4(), scaling = new Vector3(scale, scale, scale);
    let disposed = false;
    const prepare = () => {
      if (meshes.length) return;
      for (const child of source().root.children) {
        if (!(child instanceof Mesh)) continue;
        let material = child.material as MeshStandardMaterial;
        if (fading) {
          material = material.clone(); material.transparent = true; ownedMaterials.push(material);
        }
        const mesh = new InstancedMesh(child.geometry, material, capacity);
        mesh.name = `coin_chests_${child.name}`; mesh.count = 0;
        mesh.castShadow = detailed; mesh.receiveShadow = true; root.add(mesh); meshes.push(mesh);
      }
    };
    const update = (places: readonly ChestPlacement[], opacity = 1) => {
      if (disposed) return;
      if (places.length) prepare();
      const count = Math.min(capacity, places.length);
      for (const mesh of meshes) {
        mesh.count = count;
        for (let index = 0; index < count; index++) {
          const place = places[index]!;
          matrix.makeScale(scaling.x, scaling.y, scaling.z).setPosition(place.x, place.y, place.z);
          mesh.setMatrixAt(index, matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (count) mesh.computeBoundingSphere();
      }
      for (const material of ownedMaterials) {
        material.opacity = opacity; material.depthWrite = opacity >= 1;
      }
      root.visible = count > 0;
    };
    return { root, update, dispose: () => {
      if (disposed) return;
      disposed = true; meshes.forEach(mesh => mesh.dispose());
      ownedMaterials.forEach(material => material.dispose()); root.clear(); root.removeFromParent();
    } };
  };
  return { create, height: () => { source(); return size.y; },
    bounds: () => { source(); return bounds.clone(); }, dispose: () => { model?.dispose(); model = undefined; } };
};

export type CoinChestInstanceOwner = ReturnType<typeof createCoinChestInstances>;
