import { Box3, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { WELL_CYCLE_SECONDS } from "../src/render-common/buildings/well-work-cycle";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createRomanDrawBucket } from "../src/renderers/three/buildings/roman-draw-bucket";
import { createWorkerWellBucket } from "../src/renderers/three/worker-well-bucket";

const shared = new MeshStandardMaterial();
const materials = new Proxy({} as Record<BuildingSurface, MeshStandardMaterial>, {
  get: () => shared
});

it.each([true, false])("drawn and carried buckets have identical geometry on detailed=%s", detailed => {
  const drawn = createRomanDrawBucket(materials, shared, detailed).root;
  const carried = createWorkerWellBucket(materials, detailed);
  const shape = carried.getObjectByName("ware_geometry")!;
  expect(shape.children.length).toBe(drawn.children.length);
  for (let index = 0; index < drawn.children.length; index++) {
    const original = drawn.children[index] as Mesh, copy = shape.children[index] as Mesh;
    expect(copy.position.toArray()).toEqual(original.position.toArray());
    expect(copy.geometry.getAttribute("position").array).toEqual(original.geometry.getAttribute("position").array);
  }
  expect(new Box3().setFromObject(carried).getSize(new Vector3())).toMatchObject({
    x: expect.closeTo(.18, 6), y: expect.closeTo(.23, 6), z: expect.closeTo(.18, 6)
  });
  let ownedDisposed = 0, sharedDisposed = 0;
  const ownWater = (shape.getObjectByName("well_bucket_water") as Mesh).material as MeshStandardMaterial;
  ownWater.addEventListener("dispose", () => ownedDisposed++);
  const observe = () => sharedDisposed++;
  shared.addEventListener("dispose", observe);
  carried.userData.disposeOwnedMaterials();
  expect(ownedDisposed).toBe(1);
  expect(sharedDisposed).toBe(0);
  shared.removeEventListener("dispose", observe);
  for (const group of [drawn, carried]) group.traverse(object => {
    if (object instanceof Mesh) object.geometry.dispose();
  });
});


it.each([true, false])("holds a full bucket until pickup and resets the next empty draw, detailed=%s", detailed => {
  const model = createRomanBuilding(getBuildingDefinition(35), materials, detailed);
  const bucket = model.root.getObjectByName("well_bucket")!;
  const water = bucket.getObjectByName("well_bucket_water")!;
  const frame = { construction: 1, working: false, door: 0,
    workTime: WELL_CYCLE_SECONDS, wellBucketTaken: false };
  model.update(20, frame);
  expect(bucket.visible).toBe(true);
  expect(bucket.position.y).toBeCloseTo(-.24);
  expect(water.scale.y).toBe(1);
  model.update(21, { ...frame, wellBucketTaken: true });
  expect(bucket.visible).toBe(false);
  model.update(22, { ...frame, working: true, workTime: 0 });
  expect(bucket.visible).toBe(true);
  expect(water.scale.y).toBe(.001);
  model.dispose();
});
