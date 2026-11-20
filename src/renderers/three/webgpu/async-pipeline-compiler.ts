import type { Material, Object3D, WebGPURenderer } from "three/webgpu";

import {
  captureDrawState,
  createGatedRenderObjectDirect,
  type DrawArguments,
  type DrawPass,
  drawPassesOf,
  type DrawState,
  isCompiled,
  type RendererInternals,
  type RenderObjectLike,
  supportsGatedDraws,
  withDrawState
} from "./renderer-internals";

/**
 * G-W5 steady state (owner OK 2026-11-17): a render object whose node build or render pipeline is
 * not cached yet (GPU crowd variants, handcarts, window-shadow variants created after loading) is
 * not drawn on that frame. Its compile is queued and runs between frames within a CPU budget per
 * frame (Three's `compileAsync` steps, the GPU pipeline through `createRenderPipelineAsync`); the
 * object appears once its pipeline is ready, a few frames later. Cached signatures draw at once.
 *
 * The node build reads the renderer's render target and MRT and the pipeline key reads the render
 * context's attachments, all of which only hold the draw's values while that draw runs. The queue
 * therefore snapshots them (and the pass's `material.side`) and restores them around its build;
 * the node build runs synchronously in its own task because an async build would resume under
 * whatever target a frame left behind.
 *
 * `prewarm` queues objects that have not been drawn yet (the idle prewarm) behind every drawn one,
 * replaying their scene's captured draw. Three r186 builds a missing pipeline inside
 * `_renderObjectDirect`, so that private method is replaced on this renderer instance by a gated
 * copy; another Three revision keeps the stock method (draw-time builds, as before) and warns once.
 */

/**
 * Distinct node builds the queue holds before further misses compile at their draw again. Small on
 * purpose: on this host a burst (the 13-16 objects that appear in the first frame after loading)
 * compiled between frames stalled presentation for 0.7-1.1 s (the GPU process compiles the same
 * pipelines either way), while compiled in-frame it costs 0.1-0.2 s gaps as before. Sporadic later
 * misses (new variants, cargo, construction props) stay async.
 */
const MAX_PENDING_BUILDS = 4;
/** Background prewarms (objects not drawn yet) may hold only this many pending builds. */
const PREWARM_PENDING_BUILDS = 2;
/**
 * Compile CPU per frame: cache hits finish in a batch, a node build (under 10 ms measured) waits for the
 * next frame after itself, so queued builds never run back to back without a frame between them.
 */
const FRAME_BUDGET_MS = 8;
/** A background prewarm starts at most every this many frames (it only saves a later pop-in). */
const BACKGROUND_FRAME_SPACING = 4;

/** A scene's draw as the prewarm replays it for an object that has not been drawn yet. */
interface SceneDrawContext {
  camera: unknown;
  clippingContext: unknown;
  lightsNode: unknown;
  renderContext: unknown;
  state: DrawState;
}

export type PrewarmOutcome = "blocked" | "done" | "later";

type PrewarmCandidate = Object3D & { material?: Material | Material[] };

interface PendingCompile {
  /** Queued by the prewarm and not drawn yet: nothing is hidden while it compiles. */
  background: boolean;
  frame: number;
  nodeKey: unknown;
  queuedAt: number;
  renderObject: RenderObjectLike;
  started: boolean;
  state: DrawState;
}

export interface AsyncCompileStats {
  /** Render objects whose first draw waited for an async compile. */
  completed: number;
  /** Compiles that failed (the object then compiles on its next draw, as before). */
  failed: number;
  /** The longest synchronous part (node build, bindings, pipeline request) of one compile, ms. */
  longestBuildMs: number;
  /** The longest an object stayed hidden: frames and ms from its first draw to its pipeline. */
  maxHiddenFrames: number;
  maxHiddenMs: number;
  /** Draws that compiled synchronously because too many distinct builds were pending. */
  overflow: number;
  /** Drawn render objects hidden right now behind a compile. */
  hidden: number;
  /** What they are (object type and name, or its parent's name), for pop-in captures. */
  hiddenObjects: string[];
  /** Queued or compiling render objects, background prewarms included. */
  pending: number;
  /** Not-yet-drawn objects queued by the background prewarm. */
  prewarmed: number;
  queued: number;
}

/** Wraps the backend factory calls made by an async compile so the tracker counts them apart. */
export type TrackAsyncBuild = <T>(build: () => T) => T;

/** Resolves right after the next frame (a plain task where there is no `requestAnimationFrame`). */
const afterNextFrame = () => new Promise<void>(resolve => {
  if (typeof requestAnimationFrame !== "function") setTimeout(resolve, 0);
  else requestAnimationFrame(() => setTimeout(resolve, 0));
});

export const createAsyncPipelineCompiler = (renderer: WebGPURenderer, trackAsync: TrackAsyncBuild) => {
  const internals = renderer as unknown as RendererInternals;
  const { _bindings: bindings, _geometries: geometries, _nodes: nodes, _pipelines: pipelines } = internals;
  const allowed = new WeakSet<RenderObjectLike>();
  const disposed = new WeakSet<RenderObjectLike>();
  const pending = new Map<RenderObjectLike, PendingCompile>();
  /** Pending objects per node-builder cache key: the distinct builds still to run. */
  const pendingBuilds = new Map<unknown, number>();
  /** Drawn (hidden) objects compile first; background prewarms only when none waits. */
  const drawnQueue: PendingCompile[] = [];
  const backgroundQueue: PendingCompile[] = [];
  const stats: Omit<AsyncCompileStats, "hidden" | "hiddenObjects" | "pending"> = { completed: 0, failed: 0,
    longestBuildMs: 0, maxHiddenFrames: 0, maxHiddenMs: 0, overflow: 0, prewarmed: 0, queued: 0 };
  const sceneDraws = new Map<unknown, SceneDrawContext>();
  let capturing = false;
  let enabled = false;
  let frame = 0;
  let lastBackgroundFrame = -Infinity;
  let running = false;
  let stopped = false;

  const markDisposal = (renderObject: RenderObjectLike) => {
    const onDispose = renderObject.onDispose;
    renderObject.onDispose = () => {
      disposed.add(renderObject);
      onDispose.call(renderObject);
    };
  };

  /**
   * `compileAsync`'s per-object steps under the draw's state. The node build runs now; the returned
   * promise settles when the GPU pipeline, compiled off-thread, is ready.
   */
  const compile = ({ renderObject, state }: PendingCompile) => {
    const promises: Promise<unknown>[] = [];
    const started = performance.now();
    withDrawState(internals, renderObject, state, () => trackAsync(() => {
      nodes.getForRender(renderObject);
      nodes.updateBefore(renderObject);
      geometries.updateForRender(renderObject);
      nodes.updateForRender(renderObject);
      bindings.updateForRender(renderObject);
      pipelines.getForRender(renderObject, promises);
    }));
    stats.longestBuildMs = Math.max(stats.longestBuildMs, performance.now() - started);
    return Promise.all(promises).then(() => {
      if (disposed.has(renderObject)) return;
      withDrawState(internals, renderObject, state, () => nodes.updateAfter(renderObject));
    });
  };

  const settle = (item: PendingCompile, succeeded: boolean) => {
    pending.delete(item.renderObject);
    const waiting = (pendingBuilds.get(item.nodeKey) ?? 1) - 1;
    if (waiting > 0) pendingBuilds.set(item.nodeKey, waiting);
    else pendingBuilds.delete(item.nodeKey);
    // Compiled (or failed): its next draw goes ahead; a remaining miss builds there, as before.
    allowed.add(item.renderObject);
    if (!succeeded) {
      stats.failed++;
      return;
    }
    if (item.background) return;
    stats.completed++;
    stats.maxHiddenFrames = Math.max(stats.maxHiddenFrames, frame - item.frame);
    stats.maxHiddenMs = Math.max(stats.maxHiddenMs, performance.now() - item.queuedAt);
  };

  const fail = (item: PendingCompile, error: unknown) => {
    settle(item, false);
    console.warn("[webgpu] async pipeline compile failed; the object compiles on its next draw", error);
  };

  /**
   * Starts one compile: the node build runs now (under 10 ms measured), the GPU pipeline compiles
   * off-thread and several may be in flight (one at a time kept 50+ objects hidden for 100 frames).
   */
  const compileNext = (item: PendingCompile) => {
    item.started = true;
    if (disposed.has(item.renderObject)) {
      settle(item, true);
      return;
    }
    try {
      compile(item).then(() => settle(item, true), (error: unknown) => fail(item, error));
    } catch (error) {
      fail(item, error);
    }
  };

  /** The next item to start: every drawn one first, a background one only now and then. */
  const nextItem = () => {
    const drawn = drawnQueue.shift();
    if (drawn !== undefined) return drawn;
    if (frame - lastBackgroundFrame < BACKGROUND_FRAME_SPACING) return undefined;
    const background = backgroundQueue.shift();
    if (background !== undefined) lastBackgroundFrame = frame;
    return background;
  };

  const drain = async () => {
    running = true;
    try {
      let budgetStart = performance.now();
      while (!stopped && (drawnQueue.length > 0 || backgroundQueue.length > 0)) {
        const item = nextItem();
        // A promoted background item sits in both queues: it compiles once.
        if (item !== undefined && !item.started) compileNext(item);
        if (item !== undefined && performance.now() - budgetStart < FRAME_BUDGET_MS) continue;
        await afterNextFrame();
        budgetStart = performance.now();
      }
    } finally { running = false; }
  };

  const startDrain = () => {
    if (!running) setTimeout(() => void drain(), 0);
  };

  const enqueue = (renderObject: RenderObjectLike, nodeKey: unknown, state: DrawState, background: boolean) => {
    const item = { background, frame, nodeKey, queuedAt: performance.now(), renderObject, started: false, state };
    pending.set(renderObject, item);
    pendingBuilds.set(nodeKey, (pendingBuilds.get(nodeKey) ?? 0) + 1);
    markDisposal(renderObject);
    (background ? backgroundQueue : drawnQueue).push(item);
    if (!background) stats.queued++;
    startDrain();
  };

  /** A background prewarm is drawn before it is ready: it is hidden from now on and compiles next. */
  const promote = (item: PendingCompile) => {
    Object.assign(item, { background: false, frame, queuedAt: performance.now() });
    stats.queued++;
    if (item.started) return;
    drawnQueue.push(item);
    startDrain();
  };

  /** False while the render object's pipeline is still compiling (or was just queued). */
  const mayDraw = (renderObject: RenderObjectLike, material: Material) => {
    if (!enabled || allowed.has(renderObject)) return true;
    const waiting = pending.get(renderObject);
    if (waiting !== undefined) {
      if (waiting.background) promote(waiting);
      return false;
    }
    if (isCompiled(internals, renderObject)) {
      allowed.add(renderObject);
      return true;
    }
    const nodeKey = nodes.getForRenderCacheKey(renderObject);
    if (pendingBuilds.size >= MAX_PENDING_BUILDS && !pendingBuilds.has(nodeKey)) {
      stats.overflow++;
      allowed.add(renderObject);
      return true;
    }
    enqueue(renderObject, nodeKey, captureDrawState(internals, renderObject, material), false);
    return false;
  };

  /** The first draw of each scene while capturing: what a later prewarm of that scene replays. */
  const captureSceneDraw = (args: DrawArguments, renderObject: RenderObjectLike) => {
    const [, material, scene, camera, lightsNode, , clippingContext, passId] = args;
    if ((passId !== null && passId !== undefined) || sceneDraws.has(scene)) return;
    sceneDraws.set(scene, { camera, clippingContext, lightsNode, renderContext: internals._currentRenderContext,
      state: captureDrawState(internals, renderObject, material) });
  };

  /** One pass of a not-yet-drawn object, its render object made under the side that pass draws with. */
  const prewarmPass = (object: PrewarmCandidate, scene: unknown, draw: SceneDrawContext, pass: DrawPass) => {
    const material = object.material as Material;
    const resting = material.side;
    material.side = pass.side;
    try {
      const renderObject = internals._objects.get(object, material, scene, draw.camera, draw.lightsNode,
        draw.renderContext, draw.clippingContext, pass.passId);
      if (allowed.has(renderObject) || pending.has(renderObject)) return;
      if (isCompiled(internals, renderObject)) {
        allowed.add(renderObject);
        return;
      }
      stats.prewarmed++;
      enqueue(renderObject, nodes.getForRenderCacheKey(renderObject), { ...draw.state, side: pass.side }, true);
    } finally { material.side = resting; }
  };

  /**
   * Queues the compile of an object that has not been drawn yet (hidden, empty or off-screen) as the
   * scene's captured draw would draw it. `later`: not judged now (its scene was not drawn, its
   * material not ported yet); `blocked`: the background budget is full, retry after a while.
   */
  const prewarm = (object: PrewarmCandidate, scene: unknown): PrewarmOutcome => {
    if (pendingBuilds.size >= PREWARM_PENDING_BUILDS) return "blocked";
    const draw = sceneDraws.get(scene);
    const material = object.material;
    if (draw === undefined || material === undefined || Array.isArray(material) ||
      (material as { isNodeMaterial?: boolean }).isNodeMaterial !== true) return "later";
    try {
      for (const pass of drawPassesOf(material)) prewarmPass(object, scene, draw, pass);
    } catch (error) {
      // An object Three cannot describe outside its own draw (e.g. an uninitialised batch): skip it.
      console.warn("[webgpu] background pipeline prewarm skipped an object", error);
    }
    return "done";
  };

  const supported = supportsGatedDraws();
  const stock = internals._renderObjectDirect;
  if (supported) {
    internals._renderObjectDirect = createGatedRenderObjectDirect(stock, (args, renderObject) => {
      if (capturing) captureSceneDraw(args, renderObject);
      return mayDraw(renderObject, args[1]);
    });
  } else console.warn("[webgpu] async pipeline compile needs Three r186; drawing compiles stay");

  return {
    /** From now on an uncompiled draw is deferred (after the loading-screen prewarm). */
    enable: () => { enabled = supported; },
    endFrame: () => {
      frame++;
      capturing = false;
    },
    prewarm,
    /** Captures each scene's first draw of the next frame (renderer state for later prewarms). */
    requestSceneDraws: () => {
      sceneDraws.clear();
      capturing = true;
    },
    stats: (): AsyncCompileStats => {
      const hiddenObjects: string[] = [];
      for (const { background, renderObject: { object } } of pending.values()) {
        if (!background) hiddenObjects.push(`${object.type}:${object.name || object.parent?.name || "-"}`);
      }
      return { ...stats, hidden: hiddenObjects.length, hiddenObjects, pending: pending.size };
    },
    dispose: () => {
      stopped = true;
      drawnQueue.length = 0;
      backgroundQueue.length = 0;
      pending.clear();
      pendingBuilds.clear();
      if (supported) internals._renderObjectDirect = stock;
    }
  };
};

export type AsyncPipelineCompiler = ReturnType<typeof createAsyncPipelineCompiler>;
