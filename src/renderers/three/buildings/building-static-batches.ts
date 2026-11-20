import {
  BatchedMesh, BufferAttribute, BufferGeometry, type Camera, type Material, Matrix4, type Mesh, type Object3D,
  OrthographicCamera, type Scene, Sphere, type TypedArray, type WebGLRenderer
} from "three";

import {
  collectStaticBatchMeshes, drawsAfterSharedMaterials, mergeOwnerStaticMeshes, ownsStaticBatchGeometry,
  staticBatchLayout, staticBatchMaterialOf
} from "./building-static-batch-geometry";

/**
 * Source meshes drawn by a batch move to this layer: the cameras skip them, while every raycaster
 * that inspects building models (picking, ceilings, fire anchors) enables it.
 */
export const BUILDING_BATCH_SOURCE_LAYER = 5;
/** Main-thread time per frame for adding finished buildings to their batches (at least one each frame). */
const ADD_BUDGET_MS = 2;
const INITIAL_INSTANCES = 8;
const MIN_VERTICES = 1024;
/** Buffer slack after growing or shrinking: growth stays amortized, memory stays near the live size. */
const GROWTH = 1.5;

/** One multi-draw per material and vertex layout; grows by doubling, compacts after removals. */
type Slot = {
  appendedIndices: number; appendedVertices: number; batch: BatchedMesh; bounds: Sphere; boundsDirty: boolean;
  /** Last frame a pending unit asked for this slot: a slot it still waits for is not trimmed meanwhile. */
  claimedAt: number;
  compiling: boolean; entries: Set<Entry>; liveIndices: number; liveInstances: number; liveVertices: number;
  maxIndices: number; maxInstances: number; maxVertices: number; ready: boolean;
};
/** `bounds`: the merged part's world bounds (buildings never move while batched). */
type Entry = { bounds: Sphere; geometryId: number; indices: number; instanceId: number; slot: Slot; vertices: number };
type Plan = { key: string; material: Material; meshes: Mesh[] }[];
type Unit = {
  baked: Matrix4[];
  entries: Entry[];
  geometries: Mesh["geometry"][];
  masks: number[];
  materials: Mesh["material"][];
  meshes: Mesh[];
  owner: Object3D;
  plan: Plan | undefined;
  seen: number;
  /** False while the unit is a parked detail variant: batched in the background, its instances hidden. */
  shown: boolean;
  state: "batched" | "idle" | "pending";
  suspended: boolean;
};

const isBypassProbe = () => (globalThis as { __probeNoBuildingBatch?: boolean }).__probeNoBuildingBatch === true;

const hideSources = (unit: Unit) => {
  unit.masks = unit.meshes.map(mesh => mesh.layers.mask);
  for (const mesh of unit.meshes) mesh.layers.set(BUILDING_BATCH_SOURCE_LAYER);
};

const showSources = (unit: Unit) => {
  unit.meshes.forEach((mesh, index) => { mesh.layers.mask = unit.masks[index] ?? 1; });
};

/** A batched unit no longer matches its copy: a part moved, or its material or geometry was replaced. */
const hasDrifted = (unit: Unit) => {
  for (let i = 0; i < unit.meshes.length; i++) {
    const mesh = unit.meshes[i]!;
    if (!mesh.matrixWorld.equals(unit.baked[i]!)) return true;
    // Hover lends a suspended model brighter materials meanwhile.
    if (!unit.suspended && mesh.material !== unit.materials[i]) return true;
    if (mesh.geometry !== unit.geometries[i]) return true;
  }
  return false;
};

/** Meshes per batch key in traversal order: one merged geometry per key and building. */
const planUnit = (owner: Object3D, materialFor: (mesh: Mesh) => Material): Plan => {
  const groups = new Map<string, { key: string; material: Material; meshes: Mesh[] }>();
  for (const mesh of collectStaticBatchMeshes(owner)) {
    const material = materialFor(mesh);
    const key = `${material.uuid}|${mesh.renderOrder}|${staticBatchLayout(mesh.geometry)}`;
    const group = groups.get(key);
    if (group) group.meshes.push(mesh);
    else groups.set(key, { key, material, meshes: [mesh] });
  }
  return [...groups.values()];
};

/** Bit-exact positions: each instance matrix is the building's own model-view matrix, so the batch's is I. */
const lockIdentityModelView = (batch: BatchedMesh) => {
  const locked = batch.modelViewMatrix as Matrix4 & { multiplyMatrices: Matrix4["multiplyMatrices"] };
  locked.multiplyMatrices = () => locked.identity();
};

/** An attribute-compatible empty geometry: initializes a batch's buffers without reserving space. */
const emptyLike = (geometry: BufferGeometry) => {
  const empty = new BufferGeometry();
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const { array, itemSize, normalized } = attribute as BufferAttribute;
    empty.setAttribute(name, new BufferAttribute(new (array.constructor as new (length: number) => TypedArray)(0),
      itemSize, normalized));
  }
  empty.setIndex(new BufferAttribute(new Uint16Array(0), 1));
  return empty;
};

const createSlot = (material: Material, reference: BufferGeometry): Slot => {
  const vertices = reference.getAttribute("position").count, indices = reference.index?.count ?? vertices;
  const maxVertices = Math.max(MIN_VERTICES, Math.ceil(vertices * GROWTH));
  const maxIndices = Math.max(MIN_VERTICES * 2, Math.ceil(indices * GROWTH));
  const batch = new BatchedMesh(INITIAL_INSTANCES, maxVertices, maxIndices, material);
  batch.name = "building-static-batch";
  batch.matrixAutoUpdate = false;
  // Camera-relative bounds, refreshed each frame from the world bounds of its instances.
  batch.boundingSphere = new Sphere();
  lockIdentityModelView(batch);
  const empty = emptyLike(reference);
  batch.deleteGeometry(batch.addGeometry(empty));
  empty.dispose();
  return { appendedIndices: 0, appendedVertices: 0, batch, bounds: new Sphere(), boundsDirty: true, claimedAt: 0,
    compiling: false,
    entries: new Set(), liveIndices: 0, liveInstances: 0, liveVertices: 0, maxIndices, maxInstances: INITIAL_INSTANCES,
    maxVertices, ready: false };
};

const compact = (slot: Slot) => {
  if (slot.liveVertices === slot.appendedVertices && slot.liveIndices === slot.appendedIndices) return;
  slot.batch.optimize();
  slot.appendedVertices = slot.liveVertices; slot.appendedIndices = slot.liveIndices;
};

const resize = (slot: Slot, vertices: number, indices: number) => {
  slot.maxVertices = Math.max(MIN_VERTICES, Math.ceil(vertices * GROWTH));
  slot.maxIndices = Math.max(MIN_VERTICES * 2, Math.ceil(indices * GROWTH));
  slot.batch.setGeometrySize(slot.maxVertices, slot.maxIndices);
};

/** Room for one more geometry: compact deleted ranges first, then grow the buffers. */
const reserve = (slot: Slot, vertices: number, indices: number) => {
  const fits = () => slot.appendedVertices + vertices <= slot.maxVertices &&
    slot.appendedIndices + indices <= slot.maxIndices;
  if (!fits()) compact(slot);
  if (!fits()) resize(slot, slot.appendedVertices + vertices, slot.appendedIndices + indices);
  if (slot.liveInstances < slot.maxInstances) return;
  slot.maxInstances = Math.ceil(slot.maxInstances * GROWTH);
  slot.batch.setInstanceCount(slot.maxInstances);
};

/** Mostly emptied (buildings demolished, a detail switch): give the memory back. */
const isOversized = (slot: Slot) => slot.maxVertices > MIN_VERTICES * 4 && slot.liveVertices * 4 < slot.maxVertices;

const addToSlot = (slot: Slot, geometry: BufferGeometry, ownerMatrix: Matrix4): Entry => {
  const vertices = geometry.getAttribute("position").count, indices = geometry.index!.count;
  reserve(slot, vertices, indices);
  const geometryId = slot.batch.addGeometry(geometry);
  const instanceId = slot.batch.addInstance(geometryId);
  slot.appendedVertices += vertices; slot.appendedIndices += indices;
  slot.liveVertices += vertices; slot.liveIndices += indices; slot.liveInstances++;
  const bounds = slot.batch.getBoundingSphereAt(geometryId, new Sphere())!.applyMatrix4(ownerMatrix);
  const entry = { bounds, geometryId, indices, instanceId, slot, vertices };
  slot.entries.add(entry); slot.boundsDirty = true;
  return entry;
};

const removeEntry = (entry: Entry) => {
  const { geometryId, indices, slot, vertices } = entry;
  slot.batch.deleteGeometry(geometryId);
  slot.liveVertices -= vertices; slot.liveIndices -= indices; slot.liveInstances--;
  slot.entries.delete(entry); slot.boundsDirty = true;
};

/** Whole-batch culling: the world bounds of all instances, in the batch's camera-relative frame. */
const updateBatchBounds = (slot: Slot, view: Matrix4) => {
  if (slot.boundsDirty) {
    slot.bounds.makeEmpty();
    for (const { bounds } of slot.entries) slot.bounds.union(bounds);
    slot.boundsDirty = false;
  }
  slot.batch.boundingSphere!.copy(slot.bounds);
  if (!slot.bounds.isEmpty()) slot.batch.boundingSphere!.applyMatrix4(view);
};

/**
 * Draws the static parts of every finished building with one multi-draw per material (three's
 * BatchedMesh, culled per building). Units (a model or a road marker, keyed by their root) join
 * once eligible and leave at once on any change; nothing rebuilds per frame. Each instance matrix is
 * the building's model-view matrix computed exactly as three computes it for the source mesh, so
 * depths, and thus every coplanar tie, match the unbatched draw.
 */
export const createBuildingStaticBatches = (scene: Scene, renderer?: WebGLRenderer) => {
  const units = new Map<Object3D, Unit>();
  const pendingUnits = new Set<Unit>();
  const slots = new Map<string, Slot>();
  const afterShared = new Map<Material, Material>();
  const suspendedOwners = new Set<Object3D>();
  const pendingCompiles = new Set<Promise<void>>();
  const fallbackCamera = new OrthographicCamera();
  const modelView = new Matrix4(), lastView = new Matrix4();
  let camera: Camera | undefined, frame = 0, bypass = false, disposed = false, addMs = 0, matricesStale = true;
  /** A clone made after every shared material keeps the walls' draw order behind them (opaque sort by id). */
  const materialFor = (mesh: Mesh) => {
    const material = staticBatchMaterialOf(mesh)!;
    if (!drawsAfterSharedMaterials(mesh)) return material;
    let clone = afterShared.get(material);
    if (!clone) {
      clone = material.clone();
      clone.onBeforeCompile = material.onBeforeCompile;
      clone.customProgramCacheKey = material.customProgramCacheKey;
      afterShared.set(material, clone);
    }
    return clone;
  };
  const showInstances = (unit: Unit, visible: boolean) => {
    for (const { instanceId, slot } of unit.entries) slot.batch.setVisibleAt(instanceId, visible);
  };
  const drawsInstances = (unit: Unit) => unit.shown && !unit.suspended && !bypass;
  /** Parking only hides or shows the instances: the merged copy stays, so a detail switch costs no rebuild. */
  const setShown = (unit: Unit, shown: boolean) => {
    if (unit.shown === shown) return;
    unit.shown = shown;
    if (unit.state !== "batched") return;
    showInstances(unit, drawsInstances(unit));
    matricesStale = true;
  };
  const release = (unit: Unit) => {
    if (unit.state === "batched" && !unit.suspended && !bypass) showSources(unit);
    for (const entry of unit.entries) removeEntry(entry);
    pendingUnits.delete(unit);
    Object.assign(unit, { baked: [], entries: [], masks: [], meshes: [], plan: undefined, state: "idle" });
  };
  const compileSlot = (slot: Slot) => {
    slot.compiling = true;
    const activate = () => {
      if (disposed) return;
      slot.ready = true;
      matricesStale = true;
      slot.batch.visible = !bypass;
      scene.add(slot.batch);
    };
    if (!renderer) { activate(); return; }
    // Shader programs compile off the frame (parallel compile) before the batch draws.
    const done = renderer.compileAsync(slot.batch, camera ?? fallbackCamera, scene).catch(() => undefined)
      .then(activate).finally(() => pendingCompiles.delete(done));
    pendingCompiles.add(done);
  };
  /** Every slot of the plan exists and has compiled. */
  const slotsReady = (plan: Plan) => {
    let ready = true;
    for (const { key, material, meshes } of plan) {
      let slot = slots.get(key);
      if (!slot) slots.set(key, slot = createSlot(material, meshes[0]!.geometry));
      slot.claimedAt = frame;
      if (!slot.compiling) compileSlot(slot);
      ready &&= slot.ready;
    }
    return ready;
  };
  const adopt = (unit: Unit, plan: Plan) => {
    unit.entries = plan.map(({ key, meshes }) => {
      const geometry = mergeOwnerStaticMeshes(meshes, unit.owner);
      const entry = addToSlot(slots.get(key)!, geometry, unit.owner.matrixWorld);
      geometry.dispose();
      return entry;
    });
    unit.meshes = plan.flatMap(group => group.meshes);
    unit.materials = unit.meshes.map(mesh => mesh.material);
    unit.geometries = unit.meshes.map(mesh => mesh.geometry);
    unit.baked = unit.meshes.map(mesh => mesh.matrixWorld.clone());
    unit.state = "batched";
    matricesStale = true;
    showInstances(unit, drawsInstances(unit));
    if (unit.suspended || bypass) return;
    hideSources(unit);
    // Never drawn while batched: free the duplicate GPU copy (three uploads it again when needed).
    for (const mesh of unit.meshes) if (ownsStaticBatchGeometry(mesh)) mesh.geometry.dispose();
  };
  const tryAdd = (unit: Unit) => {
    unit.plan ??= planUnit(unit.owner, materialFor);
    if (!unit.plan.length) { pendingUnits.delete(unit); return; }
    if (!slotsReady(unit.plan)) return;
    pendingUnits.delete(unit);
    adopt(unit, unit.plan);
  };
  /**
   * At most one slot per frame: an empty slot is dropped (unless a pending unit claimed it since the
   * previous frame: dropping it would recreate and recompile it forever), an oversized one compacted.
   */
  const trimSlots = () => {
    for (const [key, slot] of slots) {
      if (!slot.ready) continue;
      if (!slot.liveInstances) {
        if (slot.claimedAt >= frame - 1) continue;
        slot.batch.removeFromParent(); slot.batch.dispose(); slots.delete(key);
        return;
      }
      if (!isOversized(slot)) continue;
      compact(slot);
      resize(slot, slot.liveVertices, slot.liveIndices);
      return;
    }
  };
  /** Adds pending units until `budgetMs` is spent (none at 0: the frame already built a model). */
  const flush = (budgetMs = ADD_BUDGET_MS) => {
    if (budgetMs <= 0) return;
    const started = performance.now();
    trimSlots();
    for (const unit of pendingUnits) {
      tryAdd(unit);
      if (performance.now() - started >= budgetMs) break;
    }
    addMs += performance.now() - started;
  };
  const createUnit = (owner: Object3D): Unit => {
    const unit: Unit = { baked: [], entries: [], geometries: [], masks: [], materials: [], meshes: [], owner,
      plan: undefined,
      seen: frame, shown: true, state: "idle", suspended: suspendedOwners.has(owner) };
    units.set(owner, unit);
    return unit;
  };
  /**
   * One building part this frame; call after the scene's world matrices are current. `shown: false`
   * parks the unit: it stays (or becomes) batched with hidden instances, and its matrices are frozen.
   */
  const visit = (owner: Object3D, eligible: boolean, shown = true) => {
    const unit = units.get(owner) ?? createUnit(owner);
    unit.seen = frame;
    if (unit.state === "batched" && (!eligible || (shown && hasDrifted(unit)))) release(unit);
    if (unit.state === "pending" && !eligible) release(unit);
    setShown(unit, shown);
    if (unit.state !== "idle" || !eligible) return;
    unit.state = "pending";
    pendingUnits.add(unit);
  };
  const setBypass = (value: boolean) => {
    if (value === bypass) return;
    bypass = value;
    for (const slot of slots.values()) slot.batch.visible = !bypass;
    for (const unit of units.values()) {
      if (unit.state !== "batched" || unit.suspended) continue;
      if (bypass) showSources(unit);
      else hideSources(unit);
      showInstances(unit, drawsInstances(unit));
    }
  };
  const begin = () => { frame++; setBypass(isBypassProbe()); };
  const end = (addBudgetMs = ADD_BUDGET_MS) => {
    for (const unit of units.values()) {
      if (unit.seen === frame) continue;
      release(unit);
      units.delete(unit.owner); suspendedOwners.delete(unit.owner);
    }
    flush(addBudgetMs);
  };
  /** Hover brightens a model's own materials: a suspended unit draws itself until resumed. */
  const setSuspended = (owner: Object3D | undefined, suspended: boolean) => {
    if (!owner) return;
    if (suspended) suspendedOwners.add(owner);
    else suspendedOwners.delete(owner);
    const unit = units.get(owner);
    if (!unit || unit.suspended === suspended) return;
    unit.suspended = suspended;
    if (unit.state !== "batched" || bypass) return;
    if (suspended) showSources(unit);
    else hideSources(unit);
    showInstances(unit, drawsInstances(unit));
  };
  /**
   * Instance matrices for this camera: three's own `modelViewMatrix` product for each building.
   * Skipped while neither the camera nor the batched set changed (no texture uploads then).
   */
  const beforeRender = (view: Camera) => {
    camera = view;
    const refresh = matricesStale || !view.matrixWorldInverse.equals(lastView);
    for (const slot of slots.values()) {
      if (refresh || slot.boundsDirty) updateBatchBounds(slot, view.matrixWorldInverse);
      if (!refresh) continue;
      slot.batch.matrix.copy(view.matrixWorld);
      slot.batch.matrixWorld.copy(view.matrixWorld);
    }
    if (!refresh) return;
    lastView.copy(view.matrixWorldInverse);
    matricesStale = false;
    for (const unit of units.values()) {
      if (unit.state !== "batched" || !unit.shown) continue;
      modelView.multiplyMatrices(view.matrixWorldInverse, unit.owner.matrixWorld);
      for (const { instanceId, slot } of unit.entries) slot.batch.setMatrixAt(instanceId, modelView);
    }
  };
  const stats = () => {
    let instances = 0, vertices = 0, capacity = 0, bytes = 0;
    for (const slot of slots.values()) {
      instances += slot.liveInstances; vertices += slot.liveVertices; capacity += slot.maxVertices;
      const { attributes, index } = slot.batch.geometry;
      bytes += (index?.array.byteLength ?? 0) +
        Object.values(attributes).reduce((sum, attribute) => sum + (attribute as BufferAttribute).array.byteLength, 0);
    }
    let batched = 0, parked = 0, sources = 0;
    for (const unit of units.values()) {
      if (unit.state !== "batched") continue;
      batched++; sources += unit.meshes.length;
      if (!unit.shown) parked++;
    }
    return { buildingBatchSlots: slots.size, buildingBatchInstances: instances, buildingBatchVertices: vertices,
      buildingBatchVertexCapacity: capacity, buildingBatchBytes: bytes, buildingBatchedUnits: batched,
      buildingBatchedSources: sources, buildingBatchParkedUnits: parked, buildingBatchPending: pendingUnits.size,
      buildingBatchAddMs: Number(addMs.toFixed(1)) };
  };
  return {
    begin, beforeRender, end, flush, setSuspended, stats, visit,
    /** A/B probe: every source draws itself and the batches hide, without rebuilding anything. */
    setBypass,
    /** Adds every pending unit now and resolves when every batch has compiled (startup preparation). */
    ready: async () => {
      flush(Infinity);
      while (pendingCompiles.size) await Promise.all([...pendingCompiles]);
      flush(Infinity);
    },
    dispose: () => {
      disposed = true;
      for (const unit of units.values()) release(unit);
      for (const slot of slots.values()) { slot.batch.removeFromParent(); slot.batch.dispose(); }
      for (const clone of afterShared.values()) clone.dispose();
      units.clear(); pendingUnits.clear(); slots.clear(); afterShared.clear(); suspendedOwners.clear();
    }
  };
};
