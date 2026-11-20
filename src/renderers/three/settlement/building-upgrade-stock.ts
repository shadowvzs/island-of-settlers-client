import {
  Box3, Group, InstancedMesh, Matrix4, MeshStandardMaterial
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { BuildingDefinition } from "../../../render-common/buildings/building-catalog";
import { createWareRecipe } from "../../../render-common/wares/ware-recipe";
import { buildingLevelCost } from "../../../shared/settlement/building-levels";
import { createRomanPartGeometry } from "../buildings/roman-building";
import { disposeMeshGeometries } from "../three-mesh-resources";

/**
 * Upgrade materials are physical, not an inventory badge: carriers set the same ware models on
 * the ground beside a completed building, and they stay visible until the builder starts. The
 * simulation's reserved stock remains authoritative; this layer is display only.
 */
export const createBuildingUpgradeStock = (
  definition: BuildingDefinition,
  level: number,
  detailed: boolean,
  materials?: Readonly<Record<string, MeshStandardMaterial>>
) => {
  const cost = buildingLevelCost(definition.id, Math.max(0, level - 1));
  const root = new Group();
  root.name = "building_upgrade_stock";
  root.visible = false;
  const fallback = new MeshStandardMaterial({ color: 0x6b4a2f, roughness: .9 });
  const stockMeshes = new Map<string, InstancedMesh[]>();
  const [width, depth] = definition.gridFootprint;
  const wares = Object.keys(cost).filter(ware => cost[ware]! > 0);
  wares.forEach((ware, index) => {
    const capacity = cost[ware]!;
    const recipe = createWareRecipe(ware, detailed);
    const parts = recipe.parts.map(part => ({ part, geometry: createRomanPartGeometry(part, detailed) }));
    const bounds = new Box3();
    for (const { geometry } of parts) {
      geometry.computeBoundingBox();
      bounds.union(geometry.boundingBox!);
    }
    const pitch = bounds.max.y - bounds.min.y + .018;
    const side = index % 2 === 0 ? -1 : 1;
    const baseX = side * (width / 2 + .32);
    const baseZ = depth / 2 - .6;
    const meshes: InstancedMesh[] = [];
    for (const surface of new Set(recipe.parts.map(part => part.surface))) {
      const geometries = parts.filter(entry => entry.part.surface === surface)
        .map(entry => entry.geometry.index ? entry.geometry.toNonIndexed() : entry.geometry.clone());
      const merged = mergeGeometries(geometries)!;
      geometries.forEach(geometry => geometry.dispose());
      const mesh = new InstancedMesh(merged, materials?.[surface] ?? fallback, capacity);
      mesh.name = `upgrade_${ware}_${surface}`;
      mesh.userData.upgradeWare = ware;
      mesh.userData.capacity = capacity;
      mesh.count = 0;
      mesh.frustumCulled = false;
      for (let slot = 0; slot < capacity; slot++) {
        const row = Math.floor(slot / 3), column = slot % 3;
        mesh.setMatrixAt(slot, new Matrix4().makeTranslation(
          baseX,
          -bounds.min.y + .03 + row * pitch,
          baseZ - column * .34
        ));
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = detailed;
      mesh.receiveShadow = true;
      meshes.push(mesh);
      root.add(mesh);
    }
    parts.forEach(({ geometry }) => geometry.dispose());
    stockMeshes.set(ware, meshes);
  });
  return {
    root,
    update: (stock: Readonly<Record<string, number>> | undefined, visible: boolean) => {
      let any = false;
      for (const [ware, meshes] of stockMeshes) {
        const count = Math.max(0, Math.floor(stock?.[ware] ?? 0));
        for (const mesh of meshes) {
          mesh.count = Math.min(mesh.userData.capacity, count);
          mesh.visible = mesh.count > 0;
          any ||= mesh.visible;
        }
      }
      root.visible = visible && any;
    },
    dispose: () => {
      disposeMeshGeometries(root);
      fallback.dispose();
    }
  };
};
