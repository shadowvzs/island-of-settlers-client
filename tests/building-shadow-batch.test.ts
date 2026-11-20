import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D
} from "three";
import { expect, it, vi } from "vitest";

import { createBuildingShadowCaster } from "../src/renderers/three/buildings/building-shadows";

const sharedMaterial = new MeshBasicMaterial();

const meshWith = (positions: number[], indices?: number[]) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  if (indices) geometry.setIndex(indices);
  return new Mesh(geometry, sharedMaterial);
};

const mergedMesh = (root: Group) => {
  expect(root.children).toHaveLength(1);
  return root.children[0] as Mesh;
};

const visibleIndices = (root: Group) => {
  const index = mergedMesh(root).geometry.getIndex()!;
  const triangles: number[][] = [];
  for (let offset = 0; offset < index.count; offset += 3) {
    const triangle = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
    if (triangle.some(value => value !== 0)) triangles.push(triangle);
  }
  return triangles;
};

const effectiveVisibleTriangles = (source: Object3D) => {
  let triangles = 0;
  const walk = (object: Object3D, parentVisible: boolean) => {
    const courses = object.userData.constructionCourses as { height: { value: number } } | undefined;
    const visible = parentVisible && object.visible && !Number.isFinite(courses?.height.value);
    if (visible && object instanceof Mesh) {
      const length = object.geometry.index?.count ?? object.geometry.getAttribute("position").count;
      const drawEnd = Math.min(length, object.geometry.drawRange.start + object.geometry.drawRange.count);
      if (drawEnd > object.geometry.drawRange.start)
        triangles += Math.floor((drawEnd - object.geometry.drawRange.start) / 3);
    }
    for (const child of object.children) walk(child, visible);
  };
  walk(source, true);
  return triangles;
};

it("composes nested transforms in source-root space and mirrors the root matrix", () => {
  const source = new Group();
  source.position.set(5, 2, 3);
  source.rotation.y = Math.PI / 2;
  source.scale.setScalar(2);
  const child = new Group();
  child.position.set(2, 0, 0);
  const mesh = meshWith([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]);
  mesh.position.y = 3;
  child.add(mesh);
  source.add(child);
  const caster = createBuildingShadowCaster(source, sharedMaterial);

  caster.update();

  const geometry = mergedMesh(caster.root).geometry;
  const positions = geometry.getAttribute("position");
  expect(positions.getX(0)).toBeCloseTo(2);
  expect(positions.getY(0)).toBeCloseTo(3);
  expect(positions.getX(1)).toBeCloseTo(3);
  expect(positions.getX(2)).toBeCloseTo(2);
  expect(positions.getY(2)).toBeCloseTo(4);
  expect(caster.root.matrix.toArray()).toEqual(source.matrixWorld.toArray());
  expect(caster.root.matrixAutoUpdate).toBe(false);
  expect(visibleIndices(caster.root)).toEqual([[0, 1, 2]]);
  caster.dispose();
});

it("honours ancestor visibility, construction courses and mesh bounds", () => {
  const source = new Group();
  const ancestor = new Group();
  const mesh = meshWith([0, 0, 0, 2, 0, 0, 0, 2, 0], [0, 1, 2]);
  ancestor.add(mesh);
  source.add(ancestor);
  const caster = createBuildingShadowCaster(source, sharedMaterial);

  ancestor.visible = false;
  caster.update();
  expect(visibleIndices(caster.root)).toEqual([]);
  expect(mergedMesh(caster.root).geometry.boundingBox!.isEmpty()).toBe(true);

  ancestor.visible = true;
  mesh.userData.constructionCourses = { height: { value: .5 } };
  caster.update();
  expect(visibleIndices(caster.root)).toEqual([]);

  mesh.userData.constructionCourses.height.value = Infinity;
  caster.update();
  expect(visibleIndices(caster.root)).toEqual([[0, 1, 2]]);
  const bounds = mergedMesh(caster.root).geometry.boundingBox!;
  expect(bounds.min.toArray()).toEqual([0, 0, 0]);
  expect(bounds.max.toArray()).toEqual([2, 2, 0]);
  caster.dispose();
});

it.each([true, false])("preserves indexed=%s draw ranges", indexed => {
  const source = new Group();
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 10, 0, 0, 11, 0, 0, 10, 1, 0];
  const mesh = indexed
    ? meshWith(positions, [0, 1, 2, 3, 4, 5])
    : meshWith(positions);
  mesh.geometry.setDrawRange(3, 3);
  source.add(mesh);
  const caster = createBuildingShadowCaster(source, sharedMaterial);

  caster.update();

  expect(visibleIndices(caster.root)).toEqual([[3, 4, 5]]);
  mesh.geometry.setDrawRange(0, 6);
  caster.update();
  expect(visibleIndices(caster.root)).toEqual([[0, 1, 2], [3, 4, 5]]);
  caster.dispose();
});

it("reverses triangles for a mirrored child but not for the moving root", () => {
  const source = new Group();
  const mesh = meshWith([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]);
  mesh.position.x = 3;
  mesh.scale.x = -1;
  source.add(mesh);
  const caster = createBuildingShadowCaster(source, sharedMaterial);
  caster.update();
  expect(visibleIndices(caster.root)).toEqual([[2, 1, 0]]);

  source.position.set(100, 5, -20);
  source.scale.setScalar(.5);
  caster.update();
  expect(visibleIndices(caster.root)).toEqual([[2, 1, 0]]);
  expect(caster.root.matrix.toArray()).toEqual(source.matrixWorld.toArray());
  caster.dispose();
});

it("uploads only a moving door slice, not unchanged static vertices", () => {
  const source = new Group();
  const wall = meshWith([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]);
  const door = meshWith([10, 0, 0, 11, 0, 0, 10, 1, 0], [0, 1, 2]);
  source.add(wall, door);
  const caster = createBuildingShadowCaster(source, sharedMaterial);
  caster.update();
  const positions = mergedMesh(caster.root).geometry.getAttribute("position") as BufferAttribute;
  const wallSnapshot = Array.from(positions.array as Float32Array);
  positions.clearUpdateRanges();
  const version = positions.version;

  door.position.x = 4;
  caster.update();

  expect(Array.from((positions.array as Float32Array).slice(0, 9))).toEqual(
    wallSnapshot.slice(0, 9)
  );
  expect(positions.getX(3)).toBeCloseTo(14);
  expect(positions.version).toBeGreaterThan(version);
  expect(positions.updateRanges).toEqual([{ count: 9, start: 9 }]);
  const movedVersion = positions.version;
  positions.clearUpdateRanges();
  caster.update();
  expect(positions.version).toBe(movedVersion);
  expect(positions.updateRanges).toEqual([]);
  caster.dispose();
});

it("handles a zero-scale root without invalid merged geometry", () => {
  const source = new Group();
  source.add(meshWith([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]));
  const caster = createBuildingShadowCaster(source, sharedMaterial);
  source.scale.set(0, 0, 0);
  caster.update();

  expect(caster.root.matrix.elements.every(Number.isFinite)).toBe(true);
  expect(caster.root.matrix.determinant()).toBe(0);
  expect(visibleIndices(caster.root)).toEqual([[0, 1, 2]]);
  expect(mergedMesh(caster.root).geometry.boundingBox!.isEmpty()).toBe(false);
  caster.dispose();
});

it("rebuilds and disposes owned geometry when hierarchy or source geometry changes", () => {
  const source = new Group();
  const first = meshWith([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]);
  source.add(first);
  const caster = createBuildingShadowCaster(source, sharedMaterial);
  caster.update();
  const firstMergedGeometry = mergedMesh(caster.root).geometry;
  const firstDisposed = vi.fn();
  firstMergedGeometry.addEventListener("dispose", firstDisposed);

  const added = meshWith([5, 0, 0, 6, 0, 0, 5, 1, 0], [0, 1, 2]);
  source.add(added);
  caster.update();
  expect(firstDisposed).toHaveBeenCalledOnce();
  expect(mergedMesh(caster.root).geometry.getAttribute("position").count).toBe(6);

  source.remove(added);
  caster.update();
  expect(mergedMesh(caster.root).geometry.getAttribute("position").count).toBe(3);
  expect(caster.root.children).toHaveLength(1);
  caster.dispose();
});

it("disposes only owned geometry and never source geometry or the shared material", () => {
  const source = new Group();
  const mesh = meshWith([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]);
  source.add(mesh);
  const caster = createBuildingShadowCaster(source, sharedMaterial);
  caster.update();
  const geometry = mergedMesh(caster.root).geometry;
  const mergedDisposed = vi.fn(), sourceDisposed = vi.fn(), materialDisposed = vi.fn();
  geometry.addEventListener("dispose", mergedDisposed);
  mesh.geometry.addEventListener("dispose", sourceDisposed);
  sharedMaterial.addEventListener("dispose", materialDisposed);

  caster.dispose();
  caster.dispose();

  expect(mergedDisposed).toHaveBeenCalledOnce();
  expect(sourceDisposed).not.toHaveBeenCalled();
  expect(materialDisposed).not.toHaveBeenCalled();
  expect(caster.root.children).toHaveLength(0);
  expect(caster.getStats().vertices).toBe(0);
  sharedMaterial.removeEventListener("dispose", materialDisposed);
});

it("does not create merged geometry for a disabled quality tier", () => {
  const source = new Group();
  source.add(meshWith([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]));
  const caster = createBuildingShadowCaster(source, sharedMaterial, false);

  caster.update();

  expect(caster.root.children).toHaveLength(0);
  expect(caster.getStats()).toMatchObject({ drawCalls: 0, triangles: 0, vertices: 0 });
  caster.dispose();
});

it("keeps batched visible triangles equivalent to the source hierarchy", () => {
  const source = new Group();
  const hidden = new Group();
  hidden.visible = false;
  const hiddenMesh = meshWith([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]);
  hidden.add(hiddenMesh);
  const visible = meshWith(
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0],
    [0, 1, 2, 3, 4, 5]
  );
  source.add(hidden, visible);
  const caster = createBuildingShadowCaster(source, sharedMaterial);
  caster.update();

  expect(visibleIndices(caster.root)).toHaveLength(effectiveVisibleTriangles(source));
  expect(visibleIndices(caster.root)).toHaveLength(2);
  caster.dispose();
});
