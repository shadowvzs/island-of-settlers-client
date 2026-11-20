import { type BufferAttribute, MeshBasicMaterial } from "three";
import { expect, it } from "vitest";

import type { PropMesh } from "../src/render-common/props/mesh-builder";
import { allocatePropInstances } from "../src/render-common/props/prop-instances";
import { createContactShadows } from "../src/renderers/three/three-contact-shadows";
import { createThreePropMeshes } from "../src/renderers/three/three-props";

/** Three uploads only queued ranges when present; CPU arrays alone cannot detect stale GPU data. */
const upload = (attribute: BufferAttribute, gpu: Float32Array) => {
  const values = attribute.array as Float32Array;
  if (!attribute.updateRanges.length) gpu.set(values);
  else for (const { count, start } of attribute.updateRanges)
    gpu.set(values.subarray(start, start + count), start);
  attribute.clearUpdateRanges();
};

it("uploads compacted prop matrices fully after an earlier partial ground refresh", () => {
  const mesh: PropMesh = {
    colors: new Float32Array(), height: 1, indices: new Uint16Array(),
    normals: new Float32Array(), positions: new Float32Array(), radius: 1,
    uvs: new Float32Array(), wind: new Float32Array()
  };
  const instances = allocatePropInstances(3);
  instances.x.set([1, 2, 3]); instances.z.fill(1);
  instances.sourceIndex.set([10, 11, 12]); instances.scale.fill(1); instances.stretch.fill(1);
  const material = new MeshBasicMaterial();
  const layer = createThreePropMeshes([mesh], instances, 32, { depth: null, main: material })[0]!;
  layer.showChunks(new Uint8Array([1]));
  const matrix = layer.mesh.instanceMatrix, gpu = new Float32Array(matrix.array.length);
  upload(matrix, gpu);
  layer.refreshHeights(new Map([[10, 4]]));
  expect(matrix.updateRanges.length).toBeGreaterThan(0);
  layer.removeInstance(10); layer.commitInstances();
  upload(matrix, gpu);
  expect(layer.mesh.count).toBe(2);
  expect(gpu[12]).toBe(2);
  expect(gpu[28]).toBe(3);
  layer.mesh.geometry.dispose(); material.dispose();
});

it("uploads removed contact-shadow radii together with earlier partial height changes", () => {
  const instances = allocatePropInstances(1); instances.sourceIndex[0] = 10; instances.scale[0] = 1;
  const shadow = createContactShadows(instances, [{ contactRadius: .3 } as PropMesh], {});
  const attribute = shadow.mesh.geometry.getAttribute("contact") as BufferAttribute;
  const gpu = new Float32Array(attribute.array.length); upload(attribute, gpu);
  shadow.refreshHeights(new Map([[10, 3]])); shadow.removePlants([10]); upload(attribute, gpu);
  expect(gpu[1]).toBe(3);
  expect(gpu[3]).toBe(0);
  shadow.mesh.geometry.dispose(); shadow.mesh.material.dispose();
});

it("uses an independent shadow chunk set without changing the colour mesh", () => {
  const mesh: PropMesh = {
    colors: new Float32Array(), height: 8, indices: new Uint16Array(),
    normals: new Float32Array(), positions: new Float32Array(), radius: 1,
    uvs: new Float32Array(), wind: new Float32Array()
  };
  const instances = allocatePropInstances(2);
  instances.x.set([1, 20]); instances.z.set([1, 1]);
  instances.sourceIndex.set([10, 11]); instances.scale.fill(1); instances.stretch.fill(1);
  const material = new MeshBasicMaterial();
  const layer = createThreePropMeshes([mesh], instances, 64, {
    depth: material, main: material
  })[0]!;
  layer.showChunks(new Uint8Array([1, 0, 0, 0]));
  expect(layer.mesh.count).toBe(1);
  expect(layer.caster!.count).toBe(1);

  layer.showCasterChunks(new Uint8Array([0, 1, 0, 0]));
  expect(layer.mesh.count).toBe(1);
  expect(layer.caster!.count).toBe(1);
  expect(layer.caster!.geometry).not.toBe(layer.mesh.geometry);
  expect(layer.caster!.instanceMatrix).not.toBe(layer.mesh.instanceMatrix);

  layer.refreshHeights(new Map([[11, 4]]));
  expect((layer.caster!.instanceMatrix.array as Float32Array)[13]).toBe(4);

  layer.useMainCaster();
  expect(layer.caster!.geometry).toBe(layer.mesh.geometry);
  expect(layer.caster!.count).toBe(layer.mesh.count);
  layer.mesh.geometry.dispose(); material.dispose();
});

const twoChunkLayer = () => {
  const mesh: PropMesh = {
    colors: new Float32Array(), height: 8, indices: new Uint16Array(),
    normals: new Float32Array(), positions: new Float32Array(), radius: 1,
    uvs: new Float32Array(), wind: new Float32Array()
  };
  const instances = allocatePropInstances(2);
  instances.x.set([1, 20]); instances.z.set([1, 1]);
  instances.sourceIndex.set([10, 11]); instances.scale.fill(1); instances.stretch.fill(1);
  const material = new MeshBasicMaterial();
  const layer = createThreePropMeshes([mesh], instances, 64, { depth: material, main: material })[0]!;
  return { layer, material };
};

/**
 * three.js deletes an instanceMatrix GL buffer only when its InstancedMesh fires "dispose"
 * (WebGLObjects). GPU-LIFECYCLE-03: every possession left one private caster matrix per prop kind.
 */
it("releases the private FPS caster matrix on every return without touching shared buffers", () => {
  const { layer, material } = twoChunkLayer();
  layer.showChunks(new Uint8Array([1, 0, 0, 0]));
  const sharedMatrix = layer.mesh.instanceMatrix;
  const released: unknown[] = [];
  let sharedReleased = 0;
  layer.caster!.addEventListener("dispose", () => released.push(layer.caster!.instanceMatrix));
  layer.mesh.addEventListener("dispose", () => { sharedReleased++; });
  layer.mesh.geometry.addEventListener("dispose", () => { sharedReleased++; });
  const privateMatrices: unknown[] = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    layer.showCasterChunks(new Uint8Array([0, 1, 0, 0]));
    privateMatrices.push(layer.caster!.instanceMatrix);
    layer.useMainCaster();
  }
  expect(released).toEqual(privateMatrices);
  expect(released).not.toContain(sharedMatrix);
  expect(sharedReleased).toBe(0);
  expect(layer.caster!.instanceMatrix).toBe(sharedMatrix);
  layer.mesh.geometry.dispose(); material.dispose();
});

it("releases the outgoing instance buffers when replaced chunks grow the capacity", () => {
  const { layer, material } = twoChunkLayer();
  layer.showChunks(new Uint8Array([1, 1, 0, 0]));
  const oldMatrix = layer.mesh.instanceMatrix;
  const oldData = layer.mesh.geometry.getAttribute("instanceData");
  const released: unknown[] = [];
  layer.mesh.addEventListener("dispose", () => released.push(layer.mesh.instanceMatrix));
  layer.mesh.geometry.addEventListener("dispose", () =>
    released.push(layer.mesh.geometry.getAttribute("instanceData")));
  const grown = allocatePropInstances(4);
  grown.x.set([1, 2, 3, 4]); grown.z.fill(1); grown.sourceIndex.set([20, 21, 22, 23]);
  grown.scale.fill(1); grown.stretch.fill(1);
  layer.replaceChunks(new Set([0]), grown, [0, 1, 2, 3]);
  expect(released).toEqual([oldData, oldMatrix]);
  expect(layer.mesh.instanceMatrix).not.toBe(oldMatrix);
  layer.mesh.geometry.dispose(); material.dispose();
});
