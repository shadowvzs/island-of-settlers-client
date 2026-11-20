import {
  BatchedMesh, type BufferAttribute, type Group, InstancedMesh, type Matrix4, type Mesh, type MeshBasicMaterial
} from "three";

/** Specialized vertex paths retain their own caster instead of losing their shadows in a merge. */
export const createBuildingShadowFallback = (root: Group, material: MeshBasicMaterial) => {
  const copies = new Map<Mesh, {
    copy: Mesh; seen: number; instanceVersion: number; instanceSource?: BufferAttribute
  }>();
  let generation = 0;
  const remove = (source: Mesh) => {
    const entry = copies.get(source)!;
    entry.copy.removeFromParent();
    // Instanced/BatchedMesh own additional GPU resources; ordinary geometry remains borrowed.
    if (entry.copy instanceof InstancedMesh || entry.copy instanceof BatchedMesh) entry.copy.dispose();
    copies.delete(source);
  };
  return {
    begin: () => { generation++; },
    update: (source: Mesh, relativeMatrix: Matrix4, visible: boolean) => {
      let entry = copies.get(source);
      if (source instanceof InstancedMesh && entry?.copy instanceof InstancedMesh &&
        source.instanceMatrix.array.length !== entry.copy.instanceMatrix.array.length) {
        remove(source);
        entry = undefined;
      }
      if (!entry) {
        const copy = source.clone(false);
        copy.material = material;
        copy.matrixAutoUpdate = false;
        entry = { copy, seen: generation, instanceVersion: -1 };
        copies.set(source, entry);
        root.add(copy);
      }
      const copy = entry.copy;
      entry.seen = generation;
      if (!(copy instanceof BatchedMesh)) {
        if (copy instanceof InstancedMesh && copy.geometry !== source.geometry) {
          copy.boundingBox = null;
          copy.boundingSphere = null;
        }
        copy.geometry = source.geometry;
      }
      copy.matrix.copy(relativeMatrix);
      copy.matrixWorldNeedsUpdate = true;
      copy.visible = visible;
      if (source instanceof InstancedMesh && copy instanceof InstancedMesh) {
        if (copy.count !== source.count) {
          copy.boundingBox = null;
          copy.boundingSphere = null;
        }
        copy.count = source.count;
        if (entry.instanceSource !== source.instanceMatrix || entry.instanceVersion !== source.instanceMatrix.version) {
          copy.instanceMatrix.copy(source.instanceMatrix);
          copy.instanceMatrix.needsUpdate = true;
          copy.boundingBox = null;
          copy.boundingSphere = null;
          entry.instanceSource = source.instanceMatrix;
          entry.instanceVersion = source.instanceMatrix.version;
        }
      }
    },
    end: () => {
      for (const [source, entry] of copies) if (entry.seen !== generation) remove(source);
    },
    count: () => copies.size,
    dispose: () => { for (const source of copies.keys()) remove(source); }
  };
};
