import { BufferAttribute, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, type Material } from "three";

import type { PropMesh } from "../../render-common/props/mesh-builder";
import type { PropInstances } from "../../render-common/props/prop-instances";
import { createPropGeometry, writeMatrix } from "./three-props";

/** Felling state of a standing tree (not cut, not falling). */
export const NO_CHOP = [0, 0, 0, 0];

/**
 * Instanced copy of a prop mesh for dynamic instances (felling trees, stumps, growing trees):
 * write() the visible ones each frame, then commit() their count.
 */
export const createDynamicPropLayer = (
  mesh: PropMesh,
  capacity: number,
  main: Material,
  depth: Material | null
) => {
  const geometry = createPropGeometry(mesh);
  const fullIndex = geometry.getIndex();
  const minimalIndex = mesh.minimalIndices ? new BufferAttribute(mesh.minimalIndices, 1) : null;
  let fullDetail = true;
  const setDetail = (full: boolean) => {
    if (!minimalIndex || full === fullDetail) return;
    fullDetail = full;
    geometry.setIndex(full ? fullIndex : minimalIndex);
  };
  const attributes = {
    data: new InstancedBufferAttribute(new Float32Array(capacity * 4), 4),
    tint: new InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
    chop: new InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
  };
  geometry.setAttribute("instanceData", attributes.data);
  geometry.setAttribute("instanceTint", attributes.tint);
  geometry.setAttribute("instanceChop", attributes.chop);
  const instanced = new InstancedMesh(geometry, main, capacity);
  const caster = depth ? new InstancedMesh(geometry, depth, capacity) : null;
  for (const item of [instanced, caster]) {
    if (!item) continue;
    item.frustumCulled = false;
    item.instanceMatrix = instanced.instanceMatrix;
    item.count = 0;
    item.visible = false;
  }
  instanced.instanceMatrix.setUsage(DynamicDrawUsage);
  /** `size` scales the mesh about its foot (younger stumps, growing trees). */
  const write = (
    slot: number,
    instances: PropInstances,
    index: number,
    chop: number[],
    size = 1
  ) => {
    if (slot >= capacity) return;
    const matrices = instanced.instanceMatrix.array as Float32Array;
    writeMatrix(matrices, slot * 16, instances, index);
    for (const element of [0, 1, 2, 4, 5, 6, 8, 9, 10]) matrices[slot * 16 + element]! *= size;
    const data = [
      instances.phase[index]!,
      instances.sunVisibility[index]!,
      instances.fog[index]!,
      0
    ];
    (attributes.data.array as Float32Array).set(data, slot * 4);
    (attributes.tint.array as Float32Array).set(
      instances.tint.subarray(index * 3, index * 3 + 3),
      slot * 3
    );
    (attributes.chop.array as Float32Array).set(chop, slot * 4);
  };
  let previousCount = 0;
  const commit = (count: number) => {
    if (count === 0 && previousCount === 0) return;
    previousCount = count;
    for (const item of [instanced, caster]) {
      if (!item) continue;
      item.count = Math.min(count, capacity);
      item.visible = count > 0;
    }
    for (const attribute of [instanced.instanceMatrix, ...Object.values(attributes)]) {
      attribute.needsUpdate = true;
    }
  };
  /**
   * Releases the layer's GL buffers. three.js deletes an instance matrix only on its mesh's
   * `dispose` event and, on geometry dispose, only the index set at that moment: the swapped-out
   * detail index joins as a temporary attribute so both index buffers go.
   */
  const dispose = () => {
    instanced.removeFromParent();
    caster?.removeFromParent();
    const spareIndex = geometry.getIndex() === fullIndex ? minimalIndex : fullIndex;
    if (spareIndex) geometry.setAttribute("spareIndex", spareIndex);
    geometry.dispose();
    instanced.dispose();
    caster?.dispose();
  };
  return { caster, commit, dispose, mesh: instanced, setDetail, write };
};

export type DynamicPropLayer = ReturnType<typeof createDynamicPropLayer>;
