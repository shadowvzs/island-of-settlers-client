import {
  BatchedMesh, BoxGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, Raycaster, Scene, Vector3,
  type WebGLRenderer
} from "three";
import { expect, it } from "vitest";

import {
  markStaticBatchMesh, mergeOwnerStaticMeshes
} from "../src/renderers/three/buildings/building-static-batch-geometry";
import {
  BUILDING_BATCH_SOURCE_LAYER, createBuildingStaticBatches
} from "../src/renderers/three/buildings/building-static-batches";

const stone = new MeshStandardMaterial({ color: 0x999999 });
const wood = new MeshStandardMaterial({ color: 0x884422 });

/** A building root with a construction-stage group, as the Roman model builds it. */
const createBuilding = (x: number, options: { wall?: boolean; unmarked?: boolean } = {}) => {
  const root = new Group(), stage = new Group();
  root.position.set(x, 1, 3);
  root.rotation.y = .4;
  root.scale.setScalar(.8);
  root.add(stage);
  const base = new Mesh(new BoxGeometry(1, .2, 1), stone);
  const beam = new Mesh(new BoxGeometry(.1, .1, 1), wood);
  markStaticBatchMesh(base, stone, true, options.wall);
  if (!options.unmarked) markStaticBatchMesh(beam, wood, true);
  stage.add(base, beam);
  return { base, beam, root };
};

const createWorld = () => {
  const scene = new Scene();
  const batches = createBuildingStaticBatches(scene);
  const frame = (entries: [Group, boolean, boolean?][]) => {
    scene.updateMatrixWorld();
    batches.begin();
    for (const [root, eligible, shown] of entries) batches.visit(root, eligible, shown);
    batches.end();
  };
  const batchMeshes = () => scene.children.filter(child => child instanceof BatchedMesh) as BatchedMesh[];
  return { batches, batchMeshes, frame, scene };
};

it("keeps the exact vertex values of parts directly under the building and orients nested ones", () => {
  const { base, root } = createBuilding(0);
  const nested = new Mesh(new BoxGeometry(.2, .2, .2), stone);
  nested.position.set(.5, 0, 0);
  root.add(nested);
  root.updateMatrixWorld(true);
  const merged = mergeOwnerStaticMeshes([base, nested], root);
  const source = base.geometry.getAttribute("position").array;
  const positions = merged.getAttribute("position").array;
  expect([...positions.slice(0, source.length)]).toEqual([...source]);
  expect(positions[source.length]).toBeCloseTo(nested.geometry.getAttribute("position").array[0]! + .5);
  expect(merged.index!.count).toBe(base.geometry.index!.count + nested.geometry.index!.count);
});

it("draws finished buildings from one batch per material and hides their sources from cameras only", () => {
  const { batches, batchMeshes, frame, scene } = createWorld();
  const first = createBuilding(0), second = createBuilding(5);
  scene.add(first.root, second.root);
  frame([[first.root, true], [second.root, true]]);
  expect(batchMeshes()).toHaveLength(2);
  expect(batches.stats()).toMatchObject({ buildingBatchInstances: 4, buildingBatchedUnits: 2 });
  expect(first.base.layers.mask).toBe(1 << BUILDING_BATCH_SOURCE_LAYER);
  const ray = new Raycaster(new Vector3(0, 5, 3), new Vector3(0, -1, 0));
  expect(ray.intersectObject(first.root, true)).toHaveLength(0);
  ray.layers.enable(BUILDING_BATCH_SOURCE_LAYER);
  expect(ray.intersectObject(first.root, true).length).toBeGreaterThan(0);
});

it("returns a building to its own draws at once when it stops being eligible or disappears", () => {
  const { batches, frame, scene } = createWorld();
  const first = createBuilding(0), second = createBuilding(5);
  scene.add(first.root, second.root);
  frame([[first.root, true], [second.root, true]]);
  frame([[first.root, false], [second.root, true]]);
  expect(first.base.layers.mask).toBe(1);
  expect(batches.stats().buildingBatchInstances).toBe(2);
  frame([[first.root, false]]);
  expect(second.base.layers.mask).toBe(1);
  expect(batches.stats()).toMatchObject({ buildingBatchInstances: 0, buildingBatchedUnits: 0 });
  frame([[first.root, false]]);
  expect(batches.stats().buildingBatchSlots).toBe(0);
});

it("releases a building whose part changed material or moved, then batches it again", () => {
  const { batches, frame, scene } = createWorld();
  const { base, root } = createBuilding(0);
  scene.add(root);
  frame([[root, true]]);
  base.material = wood;
  frame([[root, true]]);
  frame([[root, true]]);
  expect(base.layers.mask).toBe(1);
  expect(batches.stats().buildingBatchedSources).toBe(1);
  base.material = stone;
  root.position.x += 1;
  frame([[root, true]]);
  expect(base.layers.mask).toBe(1 << BUILDING_BATCH_SOURCE_LAYER);
  expect(batches.stats().buildingBatchedUnits).toBe(1);
});

it("lets a hovered building draw itself (brightened materials) and resumes without rebuilding", () => {
  const { batches, batchMeshes, frame, scene } = createWorld();
  const { base, root } = createBuilding(0);
  scene.add(root);
  batches.setSuspended(root, true);
  frame([[root, true]]);
  expect(base.layers.mask).toBe(1);
  const batch = batchMeshes()[0]!;
  expect(batch.getVisibleAt(0)).toBe(false);
  base.material = new MeshStandardMaterial();
  frame([[root, true]]);
  base.material = stone;
  batches.setSuspended(root, false);
  frame([[root, true]]);
  expect(base.layers.mask).toBe(1 << BUILDING_BATCH_SOURCE_LAYER);
  expect(batch.getVisibleAt(0)).toBe(true);
  expect(batches.stats().buildingBatchInstances).toBe(2);
});

it("keeps unmarked parts on their own draw and orders construction walls after the shared materials", () => {
  const { batchMeshes, frame, scene } = createWorld();
  const plain = createBuilding(0, { unmarked: true }), walled = createBuilding(5, { wall: true });
  scene.add(plain.root, walled.root);
  frame([[plain.root, true], [walled.root, true]]);
  expect(plain.beam.layers.mask).toBe(1);
  const materials = batchMeshes().map(batch => batch.material as MeshStandardMaterial);
  expect(materials).toContain(stone);
  const wallMaterial = materials.find(material => material !== stone && material !== wood)!;
  const idOf = (material: MeshStandardMaterial) => (material as unknown as { id: number }).id;
  expect(idOf(wallMaterial)).toBeGreaterThan(idOf(stone));
  expect(wallMaterial.color.getHex()).toBe(stone.color.getHex());
});

it("gives each instance the building's model-view matrix and the batch an identity model-view", () => {
  const { batches, batchMeshes, frame, scene } = createWorld();
  const { root } = createBuilding(3);
  scene.add(root);
  frame([[root, true]]);
  const camera = new PerspectiveCamera();
  camera.position.set(10, 20, 30);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  batches.beforeRender(camera);
  const batch = batchMeshes()[0]!;
  const expected = new Matrix4().multiplyMatrices(camera.matrixWorldInverse, root.matrixWorld);
  const instance = batch.getMatrixAt(0, new Matrix4());
  expect(instance.elements).toEqual([...new Float32Array(expected.elements)]);
  batch.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, batch.matrixWorld);
  expect(batch.modelViewMatrix.equals(new Matrix4())).toBe(true);
});

it("hides every batch and restores every source for the A/B probe", () => {
  const { batches, batchMeshes, frame, scene } = createWorld();
  const { base, root } = createBuilding(0);
  scene.add(root);
  frame([[root, true]]);
  batches.setBypass(true);
  expect(base.layers.mask).toBe(1);
  expect(batchMeshes().every(batch => !batch.visible)).toBe(true);
  batches.setBypass(false);
  expect(base.layers.mask).toBe(1 << BUILDING_BATCH_SOURCE_LAYER);
  batches.dispose();
  expect(base.layers.mask).toBe(1);
});

it("keeps a parked detail variant batched with hidden instances and shows it without rebuilding", () => {
  const { batches, batchMeshes, frame, scene } = createWorld();
  const drawn = createBuilding(0), parked = createBuilding(0);
  scene.add(drawn.root);
  parked.root.updateMatrixWorld(true);
  frame([[drawn.root, true], [parked.root, true, false]]);
  expect(batches.stats()).toMatchObject({ buildingBatchInstances: 4, buildingBatchParkedUnits: 1 });
  const visibleInstances = () => batchMeshes().reduce((count, batch) => {
    for (let id = 0; id < batch.instanceCount; id++) if (batch.getVisibleAt(id)) count++;
    return count;
  }, 0);
  expect(visibleInstances()).toBe(2);
  const added = batches.stats().buildingBatchVertices;
  scene.remove(drawn.root);
  scene.add(parked.root);
  frame([[parked.root, true], [drawn.root, true, false]]);
  expect(batches.stats()).toMatchObject({ buildingBatchParkedUnits: 1, buildingBatchPending: 0,
    buildingBatchVertices: added });
  expect(visibleInstances()).toBe(2);
  expect(parked.base.layers.mask).toBe(1 << BUILDING_BATCH_SOURCE_LAYER);
});

it("keeps a new slot a pending building waits for while its program compiles", async () => {
  const scene = new Scene();
  const renderer = { compileAsync: () => Promise.resolve() } as unknown as WebGLRenderer;
  const batches = createBuildingStaticBatches(scene, renderer);
  const building = createBuilding(0);
  scene.add(building.root);
  const frame = () => {
    scene.updateMatrixWorld();
    batches.begin();
    batches.visit(building.root, true);
    batches.end();
  };
  frame();
  await batches.ready();
  frame();
  frame();
  expect(batches.stats()).toMatchObject({ buildingBatchPending: 0, buildingBatchedUnits: 1 });
});
