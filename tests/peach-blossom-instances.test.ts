import { BoxGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Vector3 } from "three";
import { expect, it, vi } from "vitest";

import {
  createPeachBlossomInstances, type PeachBlossomGeometries, type PeachBlossomMaterials
} from "../src/renderers/three/plants/peach-blossom-instances";

it("shares canonical flower surfaces across full-tree palettes and releases only owned instance buffers", () => {
  const geometries: PeachBlossomGeometries = {
    calyx: new BoxGeometry(1, 1, 1), centre: new BoxGeometry(1, 1, 1), petals: new BoxGeometry(1, 1, 1)
  };
  const materials: PeachBlossomMaterials = {
    calyx: new MeshStandardMaterial(), centre: new MeshStandardMaterial(), petals: new MeshStandardMaterial()
  };
  const flowers = [{ position: [2, 3, 4] as [number, number, number], radius: .1, pitch: .2, yaw: .5, seed: 1 },
    { position: [-2, 1, -3] as [number, number, number], radius: .2, pitch: -.3, yaw: -.4, seed: 2 }];
  const first = createPeachBlossomInstances(flowers, geometries, materials, true);
  const second = createPeachBlossomInstances(flowers, geometries, materials, false);
  const mesh = first.root.getObjectByName("peach-petals") as InstancedMesh;
  const other = second.root.getObjectByName("peach-petals") as InstancedMesh;
  expect(mesh.geometry).toBe(other.geometry); expect(mesh.material).toBe(other.material);
  expect(mesh.count).toBe(2); expect(first.triangles).toBe(72);
  const matrix = new Matrix4(); mesh.getMatrixAt(0, matrix);
  expect(new Vector3().setFromMatrixPosition(matrix).distanceTo(new Vector3(2, 3, 4))).toBeLessThan(1e-7);
  expect(new Vector3().setFromMatrixScale(matrix).x).toBeCloseTo(.1, 6);
  expect(mesh.boundingBox!.min.x).toBeLessThan(-2); expect(mesh.boundingBox!.max.z).toBeGreaterThan(4);
  const instanceReleased = vi.fn(), geometryReleased = vi.fn(), materialReleased = vi.fn();
  mesh.addEventListener("dispose", instanceReleased);
  mesh.geometry.addEventListener("dispose", geometryReleased);
  materials.petals.addEventListener("dispose", materialReleased);
  first.dispose(); first.dispose();
  expect(instanceReleased).toHaveBeenCalledTimes(1);
  expect(geometryReleased).not.toHaveBeenCalled(); expect(materialReleased).not.toHaveBeenCalled();
  expect(other.count).toBe(2); second.dispose();
  Object.values(geometries).forEach(geometry => geometry.dispose());
  Object.values(materials).forEach(material => material.dispose());
  expect(geometryReleased).toHaveBeenCalledTimes(1); expect(materialReleased).toHaveBeenCalledTimes(1);
});
