import {
  BoxGeometry, BufferAttribute, BufferGeometry, Float32BufferAttribute, Group, InstancedMesh,
  Matrix4, Mesh, MeshBasicMaterial, SkinnedMesh
} from "three";
import { expect, it, vi } from "vitest";

import { createBuildingShadowCaster } from "../src/renderers/three/buildings/building-shadows";

it("bounds pending uploads while animated shadows remain outside the light frustum", () => {
  const source = new Group();
  const material = new MeshBasicMaterial();
  const geometry = new BoxGeometry();
  const door = new Mesh(geometry, material), wall = new Mesh(geometry, material);
  source.add(wall, door);
  const caster = createBuildingShadowCaster(source, material);
  caster.update();
  const merged = (caster.root.children[0] as Mesh).geometry;
  const positions = merged.getAttribute("position") as BufferAttribute;
  const indices = merged.getIndex()!;
  for (let frame = 0; frame < 1000; frame++) {
    door.rotation.y = frame / 100;
    wall.visible = frame % 2 === 0;
    caster.update();
    // No render/upload occurs, so Three never clears the pending ranges.
    expect(positions.updateRanges.length).toBeLessThanOrEqual(2);
    expect(indices.updateRanges.length).toBeLessThanOrEqual(2);
  }
  expect(positions.updateRanges[0]).toEqual({ start: 0, count: positions.array.length });
  caster.dispose();
  geometry.dispose();
  material.dispose();
});

it("retains an indexed draw range starting between original triangle boundaries", () => {
  const source = new Group(), material = new MeshBasicMaterial();
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 0, 1
  ], 3));
  geometry.setIndex([0, 1, 2, 3, 4, 5]);
  geometry.setDrawRange(1, 3);
  source.add(new Mesh(geometry, material));
  const caster = createBuildingShadowCaster(source, material);
  caster.update();
  const merged = (caster.root.children[0] as Mesh).geometry;
  expect(Array.from(merged.index!.array).slice(0, 3)).toEqual([1, 2, 3]);
  caster.dispose();
  geometry.dispose();
  material.dispose();
});

it("retains specialized skin and instance casters, then releases only their owned resources", () => {
  const source = new Group(), scene = new Group(), material = new MeshBasicMaterial();
  const geometry = new BoxGeometry();
  const instances = new InstancedMesh(geometry, material, 2);
  instances.setMatrixAt(1, new Matrix4().makeTranslation(2, 0, 0));
  const skin = new SkinnedMesh(geometry, material);
  source.add(instances, skin);
  const caster = createBuildingShadowCaster(source, material);
  scene.add(caster.root);
  caster.update();
  expect(caster.getStats()).toMatchObject({ fallbackMeshes: 2, vertices: 0 });
  const copy = caster.root.children.find(object => object instanceof InstancedMesh) as InstancedMesh;
  expect(copy.geometry).toBe(geometry);
  const released = vi.fn(), sourceReleased = vi.fn(), geometryReleased = vi.fn();
  copy.addEventListener("dispose", released);
  instances.addEventListener("dispose", sourceReleased);
  geometry.addEventListener("dispose", geometryReleased);
  instances.setMatrixAt(1, new Matrix4().makeTranslation(4, 0, 0));
  instances.instanceMatrix.needsUpdate = true;
  caster.update();
  expect(copy.instanceMatrix.array[28]).toBe(4);
  source.remove(instances);
  caster.update();
  expect(released).toHaveBeenCalledOnce();
  caster.dispose();
  expect(scene.children).toHaveLength(0);
  expect(geometryReleased).not.toHaveBeenCalled();
  expect(sourceReleased).not.toHaveBeenCalled();
  geometry.dispose();
  instances.dispose();
  material.dispose();
});
