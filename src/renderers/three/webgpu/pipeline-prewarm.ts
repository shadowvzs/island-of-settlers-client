import type { BufferGeometry, Camera, Material, Object3D, Scene, WebGPURenderer } from "three/webgpu";

/**
 * G-W5 loading-screen prewarm. `WebGPURenderer.compileAsync` frustum-culls with the given camera and
 * then compiles every surviving object one by one (each a node-builder lookup, a pipeline lookup and
 * a yield). The game's compile camera sees almost nothing, so most pipelines were built on the first
 * visible frames instead. Here every draw signature in the scene is compiled exactly once: one
 * representative per (material, object kind, vertex layout, shadow flag) is compiled unculled and its
 * duplicates leave the camera layers meanwhile (their children are still traversed). Three's
 * node-builder and pipeline caches are keyed by the same properties, so every duplicate then finds
 * its pipeline ready.
 */

interface Renderable extends Object3D {
  count?: number;
  geometry?: BufferGeometry;
  isBatchedMesh?: boolean;
  isInstancedMesh?: boolean;
  isLine?: boolean;
  isMesh?: boolean;
  isPoints?: boolean;
  isSkinnedMesh?: boolean;
  isSprite?: boolean;
  material?: Material | Material[];
}

interface SavedState {
  frustumCulled: boolean;
  layers: number;
  object: Object3D;
  visible: boolean;
}

const layoutKeys = new WeakMap<BufferGeometry, string>();

/** Attribute names, sizes, types and interleaving, plus morph targets and the index: the pipeline's input. */
const layoutKeyOf = (geometry: BufferGeometry) => {
  const cached = layoutKeys.get(geometry);
  if (cached !== undefined) return cached;
  const attributes = Object.entries(geometry.attributes).map(([name, attribute]) => {
    const data = (attribute as { data?: { stride: number } }).data;
    const array = (attribute as { array?: ArrayLike<number> }).array ?? (data as { array?: unknown })?.array;
    return `${name}:${attribute.itemSize}:${attribute.normalized ? 1 : 0}:` +
      `${(array as object | undefined)?.constructor.name ?? "?"}:${data?.stride ?? 0}`;
  }).sort();
  const morphs = Object.entries(geometry.morphAttributes).map(([name, list]) => `${name}*${list.length}`);
  const key = `${attributes.join(",")}|${morphs.join(",")}|${geometry.index === null ? 0 : 1}`;
  layoutKeys.set(geometry, key);
  return key;
};

const kindOf = (object: Renderable) => [
  object.isSkinnedMesh, object.isBatchedMesh, object.isInstancedMesh, object.isSprite, object.isPoints,
  object.isLine
].map(flag => (flag === true ? 1 : 0)).join("");

const isRenderable = (object: Renderable) => object.material !== undefined && object.geometry !== undefined &&
  (object.isMesh === true || object.isSprite === true || object.isPoints === true || object.isLine === true);

/**
 * Three keys an instanced object's node build by its uuid. A pool that is empty during loading but
 * drawn right after it (handcart parts) opts in with `userData.prewarmOwnPipeline` and becomes its own
 * representative; one per instanced object everywhere (~1100 in S1) cost 39-60 s of loading.
 */
const instanceKeyOf = (object: Renderable) =>
  object.isInstancedMesh === true && object.userData.prewarmOwnPipeline === true ? object.uuid : "";

/** A mirrored transform flips the pipeline's front face (e.g. right door leaves, mirrored buildings). */
const mirroredOf = (object: Object3D) => (object.matrixWorld.determinant() < 0 ? 1 : 0);

const signatureOf = (object: Renderable) => {
  const materials = Array.isArray(object.material) ? object.material : [object.material!];
  return `${materials.map(material => material.uuid).join("+")}|${kindOf(object)}|` +
    `${layoutKeyOf(object.geometry!)}|${object.receiveShadow ? 1 : 0}|${mirroredOf(object)}|` +
    instanceKeyOf(object);
};

const isLight = (object: Object3D) => (object as { isLight?: boolean }).isLight === true;

/**
 * Hidden objects are compiled too (far LOD levels, pooled effects, toggled props), so zooming or a
 * newly shown variant finds its pipeline ready. Their hidden ancestors are shown for the compile,
 * a light that would only appear through that stays hidden (it would change every lit cache key),
 * every duplicate signature leaves the camera layers and each representative is unculled.
 */
const exposeRepresentatives = (scene: Scene) => {
  const saved: SavedState[] = [];
  const seen = new Set<string>();
  const save = (object: Object3D) =>
    saved.push({ frustumCulled: object.frustumCulled, layers: object.layers.mask, object, visible: object.visible });
  const expose = (object: Object3D) => {
    const renderable = object as Renderable;
    if (!isRenderable(renderable)) return;
    const signature = signatureOf(renderable);
    if (seen.has(signature)) {
      object.layers.mask = 0;
      return;
    }
    seen.add(signature);
    object.frustumCulled = false;
  };
  const walk = (object: Object3D, ancestorsShown: boolean) => {
    const shown = ancestorsShown && object.visible;
    save(object);
    if (isLight(object)) object.visible = shown;
    else object.visible = true;
    expose(object);
    for (const child of object.children) walk(child, shown);
  };
  walk(scene, true);
  return {
    representatives: seen.size,
    restore: () => {
      for (const state of saved) {
        state.object.layers.mask = state.layers;
        state.object.frustumCulled = state.frustumCulled;
        state.object.visible = state.visible;
      }
    }
  };
};

export interface PrewarmResult {
  milliseconds: number;
  representatives: number;
}

/**
 * Compiles `scenes` with one representative per draw signature. `around` wraps each scene's compile
 * (the presenter's vertex-buffer swap) so the compiled geometry is the one later drawn.
 */
export const prewarmPipelines = async (
  renderer: WebGPURenderer,
  scenes: readonly Scene[],
  camera: Camera,
  around: (scene: Scene) => () => void
): Promise<PrewarmResult> => {
  const started = performance.now();
  let representatives = 0;
  for (const scene of scenes) {
    const exposed = exposeRepresentatives(scene);
    const release = around(scene);
    representatives += exposed.representatives;
    try {
      await renderer.compileAsync(scene, camera);
    } finally {
      release();
      exposed.restore();
    }
  }
  return { milliseconds: performance.now() - started, representatives };
};
