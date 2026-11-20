import { type IUniform, type Object3D, OrthographicCamera, type Scene, type WebGLRenderer } from "three";

import { profileStep } from "../../../render-common/load-profile";
import type { QualityPreset } from "../../../render-common/quality";
import { setRetainTextureSource } from "../../../render-common/texture-source-retention";
import { releaseRetainedTextureSources } from "../buildings/building-surface-textures";
import { isSunShadowDepthTexture } from "../three-shadows";
import { SPIKE_CATEGORY_KEY } from "./spike-categories";
import { setEagerVariantBatches } from "./variant-prewarm-hint";
import type { CreateWebGpuSpikePresenter, WebGpuSpikePresenter } from "./webgpu-spike-types";

/**
 * WG-0 spike wiring: the presenter's lifecycle, the material tagging that gives the stand-ins their
 * categories, the first-frame compile and the DEV measurement globals. Kept beside the presenter so
 * `create-three-renderer` only calls `createWebGpuSpikeWiring` once and then uses the returned hooks.
 * The WebGL2 default path uses the same object for its compile timing; nothing here imports
 * `three/webgpu` (the presenter itself is injected by the WebGPU entry module).
 */

/** The scene roots the presenter colours by category: ground, water, rocks, deposits, vegetation. */
export type SpikeSceneGraph = readonly [
  ground: Object3D,
  water: Object3D,
  rocks: Object3D,
  deposits: Object3D,
  vegetation: readonly Object3D[]
];

/** Every scene of the first-frame compile, in dependency order. */
export type SpikeCompileScenes = readonly [
  main: Scene,
  waterfall: Scene,
  animals: Scene,
  birds: Scene,
  silhouettes: Scene,
  weeds: Scene,
  shadows: Scene
];

export interface SpikePrepareInput {
  /** The WebGL2 compile of the same scene list (the product path and the frozen capture baseline). */
  compile: (scenes: Scene[]) => Promise<unknown>;
  quality: QualityPreset;
  renderer: WebGLRenderer;
  sceneGraph: SpikeSceneGraph;
  scenes: SpikeCompileScenes;
  /** The shared sun shadow uniforms (three-shadows.ts); the WebGPU presenter draws the pass itself. */
  sunShadowUniforms: Record<string, IUniform>;
}

export interface WebGpuSpikeRendererOptions {
  presenter: CreateWebGpuSpikePresenter;
  rendererMode: "webgpu" | "webgpu-gl";
}

/** The spike's hooks; `active` is false when the WebGL2 path runs alone. */
export interface WebGpuSpikeWiring {
  readonly active: boolean;
  beginFrame(): void;
  dispose(): void;
  endFrame(): void;
  prepare(input: SpikePrepareInput): Promise<unknown>;
  /** Behind the loading screen, after the first hidden frames: compiles what those frames presented. */
  prewarmPresented(): Promise<unknown>;
  resize(width: number, height: number, pixelRatio: number): void;
  /** The possessed eye's auto-exposure weight (0 leaves the fixed exposure). */
  setEyeAdaptation(weight: number): void;
  /** The renderer stats fields: `renderer`, `shaderCompileMs` and the WebGPU counters. */
  statsDetails(): Record<string, number | string>;
}

const createPresenter = async (options: WebGpuSpikeRendererOptions, canvas: HTMLCanvasElement) => {
  const presenter = await options.presenter({
    canvas,
    forceWebGL: options.rendererMode === "webgpu-gl"
  });
  if (presenter === null)
    console.warn(`[wg-0] ${options.rendererMode} unavailable; using the WebGL2 renderer`);
  return presenter;
};

/** The compile list is shared; only the WebGL2 path adds the offscreen shadow scene. */
const compileSceneList = (quality: QualityPreset, scenes: SpikeCompileScenes, includeShadows: boolean) => {
  const [main, waterfall, animals, birds, silhouettes, weeds, shadows] = scenes;
  return [
    main,
    waterfall,
    animals,
    birds,
    ...(quality.animalSilhouettes ? [silhouettes] : []),
    ...(quality.refraction ? [weeds] : []),
    ...(includeShadows && quality.sunShadows ? [shadows] : [])
  ];
};

const tagSceneGraph = ([ground, water, rocks, deposits, vegetation]: SpikeSceneGraph) => {
  ground.userData[SPIKE_CATEGORY_KEY] = "terrain";
  water.userData[SPIKE_CATEGORY_KEY] = "water";
  rocks.userData[SPIKE_CATEGORY_KEY] = "rock";
  deposits.userData[SPIKE_CATEGORY_KEY] = "rock";
  for (const mesh of vegetation) mesh.userData[SPIKE_CATEGORY_KEY] = "foliage";
};

/** The possessed sky scene is ported; every offscreen WebGL pass stays WebGL-only. */
const isExplorationScene = (scene: Scene) =>
  (scene.userData as { wgExplorationSkyScene?: boolean }).wgExplorationSkyScene === true;

/**
 * The presenter draws the frame and the sun shadow atlas (C-1); every other offscreen WebGL pass is
 * dropped. The shadow pass's tile clears are redirected with its draws.
 */
const installRenderOverride = (renderer: WebGLRenderer, presenter: WebGpuSpikePresenter) => {
  renderer.render = (scene, camera) => {
    const target = renderer.getRenderTarget();
    if (target === null) presenter.render(scene as Scene, camera, null);
    else if (isSunShadowDepthTexture(target.depthTexture)) presenter.renderSunShadow(scene as Scene, camera, target);
  };
  const clear = renderer.clear.bind(renderer);
  renderer.clear = (color, depth, stencil) => {
    const target = renderer.getRenderTarget();
    if (target !== null && isSunShadowDepthTexture(target.depthTexture)) presenter.clearSunShadow(target);
    else clear(color, depth, stencil);
  };
  const compileAsync = renderer.compileAsync.bind(renderer);
  renderer.compileAsync = async (scene, camera, targetScene = null) => {
    if (isExplorationScene(scene as Scene)) {
      await presenter.compile(scene as Scene, camera);
      return scene;
    }
    return compileAsync(scene, camera, targetScene);
  };
};

/**
 * Draws the game's scene graph through the presenter while keeping the WebGL2 renderer as the
 * fallback. `options` is null on the product path: the returned hooks then only time the WebGL2
 * compile and report `renderer: "webgl"`.
 */
export const createWebGpuSpikeWiring = async (
  options: WebGpuSpikeRendererOptions | null,
  canvas: HTMLCanvasElement
): Promise<WebGpuSpikeWiring> => {
  const presenter = options === null ? null : await createPresenter(options, canvas);
  setRetainTextureSource(presenter !== null);
  setEagerVariantBatches(presenter !== null);
  const compileCamera = new OrthographicCamera();
  let shaderCompileMs = 0;

  const installCompileDevGlobal = () => {
    if (!import.meta.env.DEV) return;
    (globalThis as { __rendererCompile?: unknown }).__rendererCompile = {
      get ms() { return shaderCompileMs; }
    };
  };

  const installSpikeDevGlobal = (active: WebGpuSpikePresenter) => {
    if (!import.meta.env.DEV) return;
    (globalThis as { __webgpuSpike?: unknown }).__webgpuSpike = {
      finishPrewarm: active.finishPrewarm,
      frameTimings: active.frameTimings,
      get shaderCompileMs() { return shaderCompileMs; },
      settle: active.settle,
      shaderOf: active.shaderOf,
      stats: active.stats
    };
  };

  const compile = async (input: SpikePrepareInput) => {
    if (presenter === null) {
      await input.compile(compileSceneList(input.quality, input.scenes, true));
      return;
    }
    if (input.quality.sunShadows) presenter.setSunShadows({ scene: input.scenes[6], uniforms: input.sunShadowUniforms });
    presenter.setPostQuality({
      ambientOcclusion: input.quality.ambientOcclusion,
      bloom: input.quality.bloom,
      exposure: input.quality.exposureMode === "fps-auto",
      exposureStrength: input.quality.exposureStrength
    });
    shaderCompileMs = await presenter.prepare(
      compileSceneList(input.quality, input.scenes, false), compileCamera);
  };

  const prepare = (input: SpikePrepareInput) => {
    if (presenter !== null) {
      tagSceneGraph(input.sceneGraph);
      installRenderOverride(input.renderer, presenter);
      installSpikeDevGlobal(presenter);
    }
    const startedAt = performance.now();
    const ready = profileStep(presenter === null ? "three shader compile (start)" : "webgpu spike compile",
      () => compile(input));
    void ready.then(() => {
      if (shaderCompileMs === 0) shaderCompileMs = performance.now() - startedAt;
    });
    installCompileDevGlobal();
    return ready;
  };

  const statsDetails = (): Record<string, number | string> => {
    const compileMs = shaderCompileMs.toFixed(1);
    if (presenter === null) return { renderer: "webgl", shaderCompileMs: compileMs };
    const stats = presenter.stats();
    return {
      renderer: stats.mode,
      shaderCompileMs: compileMs,
      webgpuAdapter: stats.adapter,
      webgpuCalls: stats.calls,
      webgpuCompileMs: stats.compileMs.toFixed(1),
      webgpuGpuMs: stats.gpuMs.toFixed(2),
      webgpuMemoryMiB: (stats.memoryBytes / 1024 / 1024).toFixed(1),
      webgpuTriangles: stats.triangles
    };
  };

  return {
    active: presenter !== null,
    beginFrame: () => presenter?.beginFrame(),
    dispose: () => {
      presenter?.dispose();
      setRetainTextureSource(false);
      setEagerVariantBatches(false);
      releaseRetainedTextureSources();
      if (import.meta.env.DEV) delete (globalThis as { __webgpuSpike?: unknown }).__webgpuSpike;
    },
    endFrame: () => presenter?.endFrame(),
    prepare,
    prewarmPresented: async () => presenter?.prewarmPresented(compileCamera),
    resize: (width, height, pixelRatio) => presenter?.resize(width, height, pixelRatio),
    setEyeAdaptation: weight => presenter?.setEyeAdaptation(weight),
    statsDetails
  };
};
