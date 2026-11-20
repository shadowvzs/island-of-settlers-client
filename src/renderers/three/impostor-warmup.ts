import {
  type Box3,
  type DataTexture,
  type Object3D,
  OrthographicCamera,
  Scene,
  type WebGLRenderer,
  WebGLRenderTarget
} from "three";

import type { PresentationScheduler } from "../../render-common/presentation-scheduler";
import { createSlicedTextureUpload } from "./sliced-texture-upload";

/**
 * Atlas bytes per step. The GPU process copies them after the call returns, so the JS time of a band
 * says little about its cost: a fixed band, gated by a fence, keeps every frame's share small.
 */
const BAND_BYTES = 2 * 1024 * 1024;
/** The impostor warm-up runs ahead of later presentation jobs (it gates the far-zoom layer). */
const WARMUP_PRIORITY = 10;
/** The offscreen first draw: a few texels of the whole layer seen from above (freed right after). */
const WARM_TARGET_SIZE = 64;
/** Billboards rise above their anchors: room above the highest one for the top-down warm view. */
const WARM_VIEW_HEADROOM = 20;

/** GPU work that makes a deferred layer drawable without a first-use stall. */
export type LayerWarmup = (
  textures: readonly DataTexture[],
  layers: readonly Object3D[],
  bounds: Box3
) => { cancel: () => void; done: Promise<void> };

/**
 * A GPU fence after the work issued so far. The returned check polls without blocking (WebGL2 sync
 * status is answered asynchronously), so the next step waits for the GPU instead of queueing behind it.
 */
const createGpuFence = (gl: WebGL2RenderingContext) => {
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  let passed = sync === null;
  return () => {
    if (passed) return true;
    passed = gl.isContextLost() || gl.getSyncParameter(sync!, gl.SYNC_STATUS) === gl.SIGNALED;
    if (passed) gl.deleteSync(sync);
    return passed;
  };
};

/** Top-down orthographic view over `bounds` (the billboards face it, so their texels are sampled). */
const createTopDownCamera = (bounds: Box3) => {
  const halfX = Math.max((bounds.max.x - bounds.min.x) / 2, 1);
  const halfZ = Math.max((bounds.max.z - bounds.min.z) / 2, 1);
  const depth = bounds.max.y - bounds.min.y + WARM_VIEW_HEADROOM * 2;
  const camera = new OrthographicCamera(-halfX, halfX, halfZ, -halfZ, 0.1, depth);
  const centerX = (bounds.min.x + bounds.max.x) / 2;
  const centerZ = (bounds.min.z + bounds.max.z) / 2;
  camera.up.set(0, 0, -1);
  camera.position.set(centerX, bounds.max.y + WARM_VIEW_HEADROOM, centerZ);
  camera.lookAt(centerX, bounds.min.y, centerZ);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
};

/**
 * One real draw of a layer with its own material into a tiny temporary target: the driver's
 * first-draw work (program state, texture and buffer residency) happens here, not in the first
 * frame that shows it. Nothing reaches the screen; the previous render target is restored.
 */
const drawOffscreen = (renderer: WebGLRenderer, layer: Object3D, bounds: Box3) => {
  const previous = renderer.getRenderTarget();
  const target = new WebGLRenderTarget(WARM_TARGET_SIZE, WARM_TARGET_SIZE);
  const scene = new Scene();
  try {
    scene.add(layer);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, createTopDownCamera(bounds));
  } finally {
    scene.remove(layer);
    renderer.setRenderTarget(previous);
    target.dispose();
  }
};

/**
 * Warms the far-zoom impostor layer in leftover frame time (R23 scheduler) once its bake lands:
 * the layer's programs link in the background (KHR_parallel_shader_compile; impostors use raw
 * shaders, whose program key depends only on their material, so the frame reuses these programs)
 * while the sprite atlases upload in row bands, then each layer is drawn once offscreen so the
 * driver's first-use work happens here too. Every band and draw waits for the GPU fence of the
 * previous one. `done` resolves after the last draw; the layer stays hidden until then.
 */
export const createImpostorWarmup = (
  renderer: WebGLRenderer,
  scheduler: PresentationScheduler
): LayerWarmup => (textures, layers, bounds) => {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const uploads = textures.map(texture => createSlicedTextureUpload(renderer, texture));
  /** One layer per step: their first draws touch different programs and atlases. */
  const undrawn = [...layers];
  let compiled = false;
  let fencePassed: (() => boolean) | null = null;
  let resolveDone = () => {};
  const done = new Promise<void>(resolve => { resolveDone = resolve; });

  // Linking needs no texture data: it runs in the GPU process while the bands upload.
  // The camera only drives the traversal (the programs do not depend on it).
  const camera = new OrthographicCamera();
  void Promise.all(layers.map(layer => renderer.compileAsync(layer, camera)))
    .catch(() => undefined)
    .then(() => { compiled = true; });

  /** Issues the next band or draw; false when nothing is left to issue yet. */
  const issueNext = () => {
    if (uploads.length > 0) {
      if (uploads[0]!.step(BAND_BYTES)) uploads.shift();
      return true;
    }
    if (!compiled || undrawn.length === 0) return false;
    drawOffscreen(renderer, undrawn.shift()!, bounds);
    return true;
  };

  const step = () => {
    if (fencePassed && !fencePassed()) return false;
    fencePassed = null;
    if (issueNext()) {
      fencePassed = createGpuFence(gl);
      return false;
    }
    if (!compiled) return false;
    resolveDone();
    return true;
  };

  const job = scheduler.enqueue({ step }, WARMUP_PRIORITY);
  return {
    cancel: () => {
      job.cancel();
      resolveDone();
    },
    done
  };
};
