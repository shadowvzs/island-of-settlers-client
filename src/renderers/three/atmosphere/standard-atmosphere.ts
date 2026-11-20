import type {
  IUniform,
  Material,
  Object3D,
  Object3DEventMap,
  Scene,
  WebGLRenderer
} from "three";

import {
  installStandardAtmosphere,
  uninstallStandardAtmosphere
} from "./standard-atmosphere-material";
import { isStandardAtmosphereMaterial } from "./standard-atmosphere-shader";

export interface StandardAtmosphereBindingStats {
  readonly materials: number;
  readonly scenes: number;
  readonly watchedObjects: number;
}

export interface StandardAtmosphereBinding {
  bind(root: Object3D): void;
  dispose(): void;
  readonly stats: StandardAtmosphereBindingStats;
  getStats(): StandardAtmosphereBindingStats;
}

type MaterialObject = Object3D & { material: Material | Material[] };

interface BindingState {
  readonly renderHooks: WeakMap<Object3D, Object3D["onBeforeRender"]>;
  activeUniforms: Record<string, IUniform> | null;
  disposed: boolean;
  materialDisposers: WeakMap<Material, () => void>;
  materialRefByValue: WeakMap<Material, WeakRef<Material>>;
  readonly materialRefs: Set<WeakRef<Material>>;
  nodeRefByValue: WeakMap<Object3D, WeakRef<Object3D>>;
  readonly nodeRefs: Set<WeakRef<Object3D>>;
  readonly onChildAdded: (event: Object3DEventMap["childadded"]) => void;
  readonly onChildRemoved: (event: Object3DEventMap["childremoved"]) => void;
  readonly sceneRefs: Set<WeakRef<Object3D>>;
  seenScenes: WeakMap<Object3D, true>;
  trackedMaterials: WeakSet<Material>;
  watchedNodes: WeakSet<Object3D>;
}

const createState = (renderer: WebGLRenderer): BindingState => {
  let state!: BindingState;
  const onChildAdded = (event: Object3DEventMap["childadded"]): void => {
    if (!state.disposed) observeTree(event.child, renderer, state);
  };
  const onChildRemoved = (event: Object3DEventMap["childremoved"]): void => {
    if (!state.disposed) unobserveTree(event.child, state);
  };
  state = {
    activeUniforms: null,
    disposed: false,
    materialDisposers: new WeakMap(),
    renderHooks: new WeakMap(),
    materialRefByValue: new WeakMap(),
    materialRefs: new Set(),
    nodeRefByValue: new WeakMap(),
    nodeRefs: new Set(),
    onChildAdded,
    onChildRemoved,
    sceneRefs: new Set(),
    seenScenes: new WeakMap(),
    trackedMaterials: new WeakSet(),
    watchedNodes: new WeakSet()
  };
  return state;
};

const isScene = (root: Object3D): root is Scene =>
  Boolean((root as Scene).isScene);

const hasMaterials = (object: Object3D): object is MaterialObject => {
  const candidate = object as Object3D & { isMesh?: boolean; isSprite?: boolean };
  return Boolean(candidate.isMesh || candidate.isSprite);
};

const getMaterials = (object: Object3D): readonly Material[] => {
  if (!hasMaterials(object)) return [];
  return Array.isArray(object.material) ? object.material : [object.material];
};

const countAlive = <T extends object>(references: ReadonlySet<WeakRef<T>>): number => {
  let count = 0;
  for (const reference of references) {
    if (reference.deref()) count++;
  }
  return count;
};

const trackNode = (node: Object3D, state: BindingState): void => {
  const reference = new WeakRef(node);
  state.nodeRefByValue.set(node, reference);
  state.nodeRefs.add(reference);
};

const removeNodeReference = (node: Object3D, state: BindingState): void => {
  const reference = state.nodeRefByValue.get(node);
  if (!reference) return;
  state.nodeRefs.delete(reference);
  state.nodeRefByValue.delete(node);
};

const forgetMaterial = (material: Material, state: BindingState): void => {
  const onDispose = state.materialDisposers.get(material);
  if (onDispose) material.removeEventListener("dispose", onDispose);
  state.materialDisposers.delete(material);
  const reference = state.materialRefByValue.get(material);
  if (reference) state.materialRefs.delete(reference);
  state.materialRefByValue.delete(material);
  state.trackedMaterials.delete(material);
};

/**
 * Materials are shared and pooled, so detaching a mesh does not remove their scope. WeakRefs
 * avoid owning external materials; a material's own dispose event releases its scope.
 */
const trackMaterial = (
  material: Material,
  renderer: WebGLRenderer,
  state: BindingState
): void => {
  if (!isStandardAtmosphereMaterial(material)) return;
  if (!state.trackedMaterials.has(material)) {
    const reference = new WeakRef(material);
    state.materialRefs.add(reference);
    state.materialRefByValue.set(material, reference);
    state.trackedMaterials.add(material);
    const onDispose = () => {
      uninstallStandardAtmosphere(material, renderer);
      forgetMaterial(material, state);
    };
    state.materialDisposers.set(material, onDispose);
    material.addEventListener("dispose", onDispose);
  }
  if (state.activeUniforms) {
    installStandardAtmosphere(material, state.activeUniforms, renderer);
  }
};

const restoreRenderHook = (node: Object3D, state: BindingState): void => {
  const original = state.renderHooks.get(node);
  if (!original) return;
  node.onBeforeRender = original;
  state.renderHooks.delete(node);
};

const observeNode = (node: Object3D, renderer: WebGLRenderer, state: BindingState): void => {
  // Explicit bind also refreshes an attached mesh after a material replacement.
  for (const material of getMaterials(node)) trackMaterial(material, renderer, state);
  if (state.watchedNodes.has(node)) return;
  state.watchedNodes.add(node);
  trackNode(node, state);
  node.addEventListener("childadded", state.onChildAdded);
  node.addEventListener("childremoved", state.onChildRemoved);
  if (!hasMaterials(node)) return;
  const original = node.onBeforeRender;
  state.renderHooks.set(node, original);
  // Only submitted meshes are checked. No traversal, allocation or recompile on ordinary frames.
  node.onBeforeRender = function (drawRenderer, scene, camera, geometry, material, group) {
    original.call(this, drawRenderer, scene, camera, geometry, material, group);
    if (!state.disposed && drawRenderer === renderer) trackMaterial(material, renderer, state);
  };
};

const observeTree = (root: Object3D, renderer: WebGLRenderer, state: BindingState): void => {
  if (state.disposed) return;
  root.traverse(node => observeNode(node, renderer, state));
};

const unobserveTree = (root: Object3D, state: BindingState): void => {
  root.traverse(node => {
    if (!state.watchedNodes.has(node)) return;
    state.watchedNodes.delete(node);
    restoreRenderHook(node, state);
    node.removeEventListener("childadded", state.onChildAdded);
    node.removeEventListener("childremoved", state.onChildRemoved);
    removeNodeReference(node, state);
  });
};

const pruneDeadReferences = <T extends object>(references: Set<WeakRef<T>>): void => {
  for (const reference of references) if (!reference.deref()) references.delete(reference);
};

const watchScene = (scene: Object3D, renderer: WebGLRenderer, state: BindingState): void => {
  if (state.disposed || state.seenScenes.has(scene)) return;
  // Retired per-visit scenes/materials must not leave an ever-growing list of dead WeakRefs.
  pruneDeadReferences(state.sceneRefs);
  pruneDeadReferences(state.materialRefs);
  state.seenScenes.set(scene, true);
  state.sceneRefs.add(new WeakRef(scene));
  observeTree(scene, renderer, state);
};

const restoreNodeListeners = (state: BindingState): void => {
  for (const reference of state.nodeRefs) {
    const node = reference.deref();
    if (!node) continue;
    restoreRenderHook(node, state);
    node.removeEventListener("childadded", state.onChildAdded);
    node.removeEventListener("childremoved", state.onChildRemoved);
  }
};

const createBindingHandle = (
  renderer: WebGLRenderer,
  state: BindingState
): StandardAtmosphereBinding => {
  const originalRender = renderer.render;
  const wrappedRender: WebGLRenderer["render"] = (scene, camera) => {
    if (!state.disposed) watchScene(scene, renderer, state);
    originalRender.call(renderer, scene, camera);
  };
  renderer.render = wrappedRender;

  const bind = (root: Object3D): void => {
    if (state.disposed) return;
    if (isScene(root) && !state.seenScenes.has(root)) {
      watchScene(root, renderer, state);
      return;
    }
    observeTree(root, renderer, state);
  };

  const getStats = (): StandardAtmosphereBindingStats => ({
    materials: countAlive(state.materialRefs),
    scenes: countAlive(state.sceneRefs),
    watchedObjects: countAlive(state.nodeRefs)
  });

  return {
    bind,
    dispose: () => {
      if (state.disposed) return;
      state.disposed = true;
      state.activeUniforms = null;
      if (renderer.render === wrappedRender) renderer.render = originalRender;
      restoreNodeListeners(state);
      for (const reference of state.materialRefs) {
        const material = reference.deref();
        if (!material) continue;
        uninstallStandardAtmosphere(material, renderer);
        forgetMaterial(material, state);
      }
      state.nodeRefs.clear();
      state.sceneRefs.clear();
      state.materialRefs.clear();
      state.materialDisposers = new WeakMap();
      state.materialRefByValue = new WeakMap();
      state.nodeRefByValue = new WeakMap();
      state.trackedMaterials = new WeakSet();
      state.watchedNodes = new WeakSet();
      state.seenScenes = new WeakMap();
    },
    get stats() {
      return getStats();
    },
    getStats
  };
};

/**
 * Scoped to the renderer and scenes it draws. Only the first render of each scene traverses it;
 * later frames use Object3D child events, so adding an object outside those scenes is inert.
 */
export const createStandardAtmosphereBinding = (
  renderer: WebGLRenderer,
  uniforms: Record<string, IUniform>
): StandardAtmosphereBinding => {
  const state = createState(renderer);
  state.activeUniforms = uniforms;
  return createBindingHandle(renderer, state);
};

export { installStandardAtmosphere, uninstallStandardAtmosphere };
