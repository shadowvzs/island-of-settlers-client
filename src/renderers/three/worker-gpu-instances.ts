import {
  type AnimationClip,
  BufferAttribute,
  BufferGeometry,
  type Color,
  DynamicDrawUsage,
  Euler,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  type Scene,
  SkinnedMesh,
  Vector3
} from "three";

import type { OwnedAssetLease } from "./owned-asset-cache";
import { eagerVariantBatches, variantBatchCapacity } from "./webgpu/variant-prewarm-hint";
import {
  createCrowdBake, type CrowdBake, crowdBakeTemplate, crowdJointRemap, type CrowdPoseRows
} from "./worker-gpu-bake";
import {
  CROWD_BLEND_ATTRIBUTE, CROWD_JOINT_ATTRIBUTE, CROWD_POSE_ATTRIBUTE, CROWD_TINT_ATTRIBUTE, CrowdInstancedMaterial
} from "./worker-gpu-material";
import { crowdBakeClips } from "./worker-gpu-pose";
import type { WorkerLodTemplate } from "./worker-lod-sources";

/**
 * C06: one InstancedMesh per body type for the GPU-posed far crowd, plus one InstancedMesh of
 * contact-shadow rings shared by every GPU member. Members push their instance each frame between
 * `begin` and `flush`; capacities grow on demand (the geometry and mesh are rebuilt, the baked
 * texture and template stay).
 */

/** What a body type offers the GPU crowd (worker-body-pool.ts): its clips, rig and LOD3 file. */
export interface CrowdBodySource {
  acquireLevel3(): OwnedAssetLease<WorkerLodTemplate>;
  clips: readonly AnimationClip[];
  /** A private clone of the rig with one shared skeleton; the bake owns it. */
  cloneRig(): Object3D;
  key: string;
}

export interface CrowdRingInstances {
  createSelectionInstances(capacity: number): InstancedMesh;
  createShadowInstances(capacity: number): InstancedMesh;
  createTargetInstances(capacity: number): InstancedMesh;
}

const MATRIX_ITEMS = 16;
const POSE_ITEMS = 4;
const BLEND_ITEMS = 2;
const TINT_ITEMS = 3;
const INITIAL_CAPACITY = 32;
/** Ground height of the contact shadow and of the selection ring inside a member's group. */
const RING_HEIGHT = 0.006;
const SELECTION_RING_HEIGHT = 0.018;
const ringRotation = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0));
const ringMatrix = new Matrix4().compose(new Vector3(), ringRotation, new Vector3(1, 1, 1));

/** Growable per-frame instance data of one type (copied into the GPU attributes at flush). */
const createInstanceRecords = () => {
  let capacity = INITIAL_CAPACITY;
  let matrices = new Float32Array(capacity * MATRIX_ITEMS);
  let poses = new Float32Array(capacity * POSE_ITEMS);
  let blends = new Float32Array(capacity * BLEND_ITEMS);
  let tints = new Float32Array(capacity * TINT_ITEMS);
  let count = 0;
  const grow = () => {
    capacity *= 2;
    const next = {
      blends: new Float32Array(capacity * BLEND_ITEMS), matrices: new Float32Array(capacity * MATRIX_ITEMS),
      poses: new Float32Array(capacity * POSE_ITEMS), tints: new Float32Array(capacity * TINT_ITEMS)
    };
    next.matrices.set(matrices); next.poses.set(poses); next.blends.set(blends); next.tints.set(tints);
    ({ blends, matrices, poses, tints } = next);
  };
  return {
    get count() { return count; },
    get matrices() { return matrices; },
    get poses() { return poses; },
    get blends() { return blends; },
    get tints() { return tints; },
    begin: () => { count = 0; },
    push: (matrix: Matrix4, pose: CrowdPoseRows, tint: Color) => {
      if (count === capacity) grow();
      matrices.set(matrix.elements, count * MATRIX_ITEMS);
      const poseAt = count * POSE_ITEMS;
      poses[poseAt] = pose.rowA; poses[poseAt + 1] = pose.rowB; poses[poseAt + 2] = pose.mix; poses[poseAt + 3] = 0;
      const blendAt = count * BLEND_ITEMS;
      blends[blendAt] = pose.previousRow; blends[blendAt + 1] = pose.previousWeight;
      const tintAt = count * TINT_ITEMS;
      tints[tintAt] = tint.r; tints[tintAt + 1] = tint.g; tints[tintAt + 2] = tint.b;
      count++;
    }
  };
};

type InstanceRecords = ReturnType<typeof createInstanceRecords>;

const instancedAttribute = (items: number, capacity: number) => {
  const attribute = new InstancedBufferAttribute(new Float32Array(capacity * items), items);
  attribute.setUsage(DynamicDrawUsage);
  return attribute;
};

/** A fresh attribute over the same array: the instanced geometry never shares GPU buffers with the skinned template. */
const ownAttribute = (source: BufferAttribute) => new BufferAttribute(source.array, source.itemSize, source.normalized);

/** The instanced copy of the LOD3 template geometry: its own attributes, crowd joint rows instead of skin indices. */
const crowdGeometry = (template: SkinnedMesh, capacity: number) => {
  const source = template.geometry;
  const skinIndex = source.getAttribute("skinIndex");
  if (!(skinIndex instanceof BufferAttribute) || !(source.getAttribute("skinWeight") instanceof BufferAttribute))
    return undefined;
  const remap = crowdJointRemap(template.skeleton);
  const joints = new Float32Array(skinIndex.count * POSE_ITEMS);
  for (let index = 0; index < joints.length; index++)
    joints[index] = remap[skinIndex.getComponent(Math.floor(index / POSE_ITEMS), index % POSE_ITEMS)] ?? 0;
  const geometry = new BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    if (name === "skinIndex") continue;
    if (!(attribute instanceof BufferAttribute)) return undefined;
    geometry.setAttribute(name, ownAttribute(attribute));
  }
  if (source.index) geometry.setIndex(ownAttribute(source.index));
  geometry.setAttribute(CROWD_JOINT_ATTRIBUTE, new BufferAttribute(joints, POSE_ITEMS));
  geometry.setAttribute(CROWD_POSE_ATTRIBUTE, instancedAttribute(POSE_ITEMS, capacity));
  geometry.setAttribute(CROWD_BLEND_ATTRIBUTE, instancedAttribute(BLEND_ITEMS, capacity));
  geometry.setAttribute(CROWD_TINT_ATTRIBUTE, instancedAttribute(TINT_ITEMS, capacity));
  return geometry;
};

/** Copies a type's records into its instanced attributes and marks them for upload. */
const uploadRecords = (mesh: InstancedMesh, records: InstanceRecords) => {
  const { count } = records;
  const copy = (name: string, items: number, values: Float32Array) => {
    const attribute = mesh.geometry.getAttribute(name) as InstancedBufferAttribute;
    attribute.array.set(values.subarray(0, count * items));
    attribute.addUpdateRange(0, count * items);
    attribute.needsUpdate = true;
  };
  mesh.instanceMatrix.array.set(records.matrices.subarray(0, count * MATRIX_ITEMS));
  mesh.instanceMatrix.addUpdateRange(0, count * MATRIX_ITEMS);
  mesh.instanceMatrix.needsUpdate = true;
  copy(CROWD_POSE_ATTRIBUTE, POSE_ITEMS, records.poses);
  copy(CROWD_BLEND_ATTRIBUTE, BLEND_ITEMS, records.blends);
  copy(CROWD_TINT_ATTRIBUTE, TINT_ITEMS, records.tints);
  mesh.count = count;
};

/** One body type's instanced LOD3 body: its template lease, bake, material and mesh. */
const createCrowdType = (source: CrowdBodySource, scene: Scene) => {
  const lease = source.acquireLevel3();
  const records = createInstanceRecords();
  let template: SkinnedMesh | undefined;
  let bake: CrowdBake | undefined;
  let material: CrowdInstancedMaterial | undefined;
  let mesh: InstancedMesh | undefined;
  let capacity = variantBatchCapacity(INITIAL_CAPACITY);
  let supported = true;
  let disposed = false;

  const build = (loaded: WorkerLodTemplate) => {
    const body = loaded.meshes[0];
    if (disposed || loaded.meshes.length !== 1 || !body || !(body.material instanceof MeshStandardMaterial)) {
      supported = false; return;
    }
    try {
      bake = createCrowdBake({ clips: crowdBakeClips(source.clips), rig: source.cloneRig(),
        template: crowdBakeTemplate(body) });
    } catch (error) {
      supported = false;
      console.warn(`GPU crowd unavailable for ${source.key}`, error);
      return;
    }
    template = body;
    material = new CrowdInstancedMaterial(body.material, bake.texture);
  };
  const loading = lease.promise.then(build, error => {
    supported = false;
    if (!disposed) console.warn(`GPU crowd LOD3 could not load for ${source.key}`, error);
  });

  const rebuildMesh = () => {
    if (mesh) { mesh.removeFromParent(); mesh.geometry.dispose(); mesh.dispose(); mesh = undefined; }
    const geometry = template && crowdGeometry(template, capacity);
    if (!geometry || !material) { supported = false; return; }
    mesh = new InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.name = `crowd_gpu_${source.key}`;
    scene.add(mesh);
  };

  const ready = () => supported && !!bake?.ready() && bake.isSupported();
  /** WebGPU: the batch exists (hidden while empty) as soon as the type is baked, see variant-prewarm-hint. */
  const eager = () => eagerVariantBatches() && ready();

  return {
    get bake() { return bake; },
    key: source.key,
    loading,
    /** Baked, built and able to draw: members may hand their pose over. */
    ready,
    begin: records.begin,
    push: records.push,
    flush: () => {
      if (!records.count && !mesh && !eager()) return;
      if (records.count > capacity) { while (records.count > capacity) capacity *= 2; rebuildMesh(); }
      if (!mesh && (records.count || eager())) rebuildMesh();
      if (!mesh) return;
      uploadRecords(mesh, records);
      if (eagerVariantBatches()) mesh.visible = records.count > 0;
    },
    dispose: () => {
      disposed = true;
      if (mesh) { mesh.removeFromParent(); mesh.geometry.dispose(); mesh.dispose(); }
      material?.dispose();
      bake?.dispose();
      lease.release();
    }
  };
};

type CrowdType = ReturnType<typeof createCrowdType>;

interface RingBatch {
  begin(): void;
  dispose(): void;
  flush(): void;
  push(x: number, y: number, z: number): void;
}

/** One `InstancedMesh` of ground rings, grown on demand and rebuilt when its capacity changes. */
const createRingBatch = (
  scene: Scene, create: (capacity: number) => InstancedMesh, height: number
): RingBatch => {
  let mesh: InstancedMesh | undefined;
  let capacity = INITIAL_CAPACITY;
  let matrices = new Float32Array(capacity * MATRIX_ITEMS);
  let count = 0;
  const rebuild = () => {
    if (mesh) { mesh.removeFromParent(); mesh.dispose(); }
    mesh = create(capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    scene.add(mesh);
  };
  return {
    begin: () => { count = 0; },
    dispose: () => { if (mesh) { mesh.removeFromParent(); mesh.dispose(); mesh = undefined; } },
    flush: () => {
      if (!mesh && count) rebuild();
      if (mesh && mesh.instanceMatrix.count < capacity) rebuild();
      if (!mesh) return;
      mesh.instanceMatrix.array.set(matrices.subarray(0, count * MATRIX_ITEMS));
      mesh.instanceMatrix.addUpdateRange(0, count * MATRIX_ITEMS);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.count = count;
      // A batch with no ring in view costs no draw at all.
      mesh.visible = count > 0;
    },
    push: (x: number, y: number, z: number) => {
      if (count === capacity) {
        capacity *= 2;
        const grown = new Float32Array(capacity * MATRIX_ITEMS);
        grown.set(matrices);
        matrices = grown;
      }
      ringMatrix.setPosition(x, y + height, z);
      matrices.set(ringMatrix.elements, count * MATRIX_ITEMS);
      count++;
    }
  };
};

/** The crowd scene's GPU instance registry (one per `createThreeWorkerCrowd`). */
export const createCrowdInstances = (scene: Scene, rings: CrowdRingInstances) => {
  const types = new Map<string, CrowdType>();
  // C02: both ground-ring kinds are one draw for the whole crowd, skinned and GPU members alike.
  const shadowRings = createRingBatch(scene, rings.createShadowInstances, RING_HEIGHT);
  const selectionRings = createRingBatch(scene, rings.createSelectionInstances, SELECTION_RING_HEIGHT);
  // targetMilitary: the chased enemies' red rings, one more draw only while a chase is shown.
  const targetRings = createRingBatch(scene, rings.createTargetInstances, SELECTION_RING_HEIGHT);
  let bakeMs = 0;

  return {
    /** The instanced body of this actor's type (created on first demand), or undefined without LOD3. */
    typeFor: (source: CrowdBodySource | undefined) => {
      if (!source) return undefined;
      let type = types.get(source.key);
      if (!type) { type = createCrowdType(source, scene); types.set(source.key, type); }
      return type;
    },
    begin: () => {
      for (const type of types.values()) type.begin();
      shadowRings.begin();
      selectionRings.begin();
      targetRings.begin();
    },
    /** The contact-shadow ring of a member whose group stands at (x, y, z). */
    pushRing: (x: number, y: number, z: number) => { shadowRings.push(x, y, z); },
    /** The selection ring of a selected member whose group stands at (x, y, z). */
    pushSelectionRing: (x: number, y: number, z: number) => { selectionRings.push(x, y, z); },
    /** The red ring under an enemy the player's soldiers chase. */
    pushTargetRing: (x: number, y: number, z: number) => { targetRings.push(x, y, z); },
    flush: () => {
      for (const type of types.values()) type.flush();
      shadowRings.flush();
      selectionRings.flush();
      targetRings.flush();
    },
    /** Bakes the next unfinished type within `budgetMs` (one type at a time). */
    step: (budgetMs: number) => {
      for (const type of types.values()) {
        const bake = type.bake;
        if (!bake || bake.ready()) continue;
        const started = performance.now();
        bake.step(budgetMs);
        bakeMs += performance.now() - started;
        return;
      }
    },
    /** Loading screen: wait for the LOD3 files, then bake every known type at once. */
    prepare: async () => {
      await Promise.all([...types.values()].map(type => type.loading));
      const started = performance.now();
      for (const type of types.values()) type.bake?.finish();
      bakeMs += performance.now() - started;
    },
    /** Receipt counters: body types known to the GPU crowd and the CPU time their bakes took so far. */
    stats: () => ({ bakeMs, types: types.size }),
    dispose: () => {
      for (const type of types.values()) type.dispose();
      types.clear();
      shadowRings.dispose();
      selectionRings.dispose();
      targetRings.dispose();
    }
  };
};

export type CrowdInstances = ReturnType<typeof createCrowdInstances>;
export type CrowdInstanceType = CrowdType;
