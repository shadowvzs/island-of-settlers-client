import type { Object3D, Scene } from "three/webgpu";

import type { AsyncPipelineCompiler } from "./async-pipeline-compiler";

/**
 * G-W5 proactive compile (owner OK 2026-11-17). After loading, every hidden renderable of the
 * presented scenes (hidden pools such as handcart parts, empty variant batches, hidden LOD levels)
 * gets its pipeline queued on the async compiler, replaying its scene's captured draw, so it shows
 * at once when it appears instead of after a few hidden frames. Visible off-screen objects are left
 * to the draw-time gate: prewarming them all (each instanced object is its own node build) kept the
 * main thread busy for tens of seconds after loading. The compiler spaces these background builds.
 */

/** A scan for objects added since the last one (traversal only; the queue does the compiles). */
const SCAN_INTERVAL_MS = 2000;
const SLICE_MS = 4;

interface Renderable extends Object3D {
  count?: number;
  geometry?: unknown;
  isBatchedMesh?: boolean;
  isInstancedMesh?: boolean;
  isLine?: boolean;
  isMesh?: boolean;
  isPoints?: boolean;
  isSprite?: boolean;
  material?: unknown;
}

/** A batch sets up its GPU textures on its own first draw, so it is left to the draw-time gate. */
const isRenderable = (object: Renderable) => object.material !== undefined && object.geometry !== undefined &&
  object.isBatchedMesh !== true &&
  (object.isMesh === true || object.isSprite === true || object.isPoints === true || object.isLine === true);

export interface IdlePrewarmInput {
  compiler: AsyncPipelineCompiler;
  /** The scenes drawn so far. */
  scenes: () => Iterable<Scene>;
  /** Objects the replayed draw cannot represent (e.g. a geometry drawn through a packed twin). */
  skip: (object: Object3D) => boolean;
}

export const createIdlePipelinePrewarm = ({ compiler, scenes, skip }: IdlePrewarmInput) => {
  const handled = new WeakSet<Object3D>();
  let backlog: Array<[Object3D, Scene]> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const collect = () => {
    const found: Array<[Object3D, Scene]> = [];
    const walk = (object: Object3D, scene: Scene, ancestorsShown: boolean) => {
      const renderable = object as Renderable;
      const shown = ancestorsShown && object.visible;
      const empty = renderable.isInstancedMesh === true && renderable.count === 0;
      if ((!shown || empty) && !handled.has(object) && isRenderable(renderable) && !skip(object))
        found.push([object, scene]);
      for (const child of object.children) walk(child, scene, shown);
    };
    for (const scene of scenes()) walk(scene, scene, true);
    backlog = found;
  };

  /** One slice of the backlog; stops early when the compiler cannot take more right now. */
  const work = () => {
    const started = performance.now();
    while (backlog.length > 0 && performance.now() - started < SLICE_MS) {
      const [object, scene] = backlog[backlog.length - 1]!;
      const outcome = compiler.prewarm(object, scene);
      if (outcome === "blocked") break;
      if (outcome === "done") handled.add(object);
      backlog.pop();
    }
    schedule(backlog.length > 0 ? 0 : SCAN_INTERVAL_MS);
  };

  /** The scene draws are captured on the next frame; the slice runs right after it. */
  const tick = () => {
    if (stopped) return;
    if (backlog.length === 0) collect();
    if (backlog.length === 0) {
      schedule(SCAN_INTERVAL_MS);
      return;
    }
    compiler.requestSceneDraws();
    requestAnimationFrame(() => { timer = setTimeout(work, 0); });
  };

  const schedule = (delay: number) => {
    if (!stopped) timer = setTimeout(tick, delay);
  };

  return {
    start: () => schedule(0),
    dispose: () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      backlog = [];
    }
  };
};
