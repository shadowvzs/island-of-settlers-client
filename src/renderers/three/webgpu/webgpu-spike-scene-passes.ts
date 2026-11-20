import { Camera, Color, type Object3D, type RenderTarget, type Scene, Vector2, type WebGPURenderer } from "three/webgpu";

import type { TslPostChain } from "../../webgpu/tsl/post/post-chain";
import { surfaceLinearCapture } from "../../webgpu/tsl/surface-output";
import { prewarmPipelines } from "./pipeline-prewarm";
import { SPIKE_CATEGORY_KEY } from "./spike-categories";
import type { createVertexBufferPacker } from "./vertex-buffer-packing";

interface ScenePassDeps {
  ensurePost: () => TslPostChain | null;
  packer: ReturnType<typeof createVertexBufferPacker>;
  refractionTarget: RenderTarget;
  renderer: WebGPURenderer;
  replaceSceneMaterials: (scene: Scene) => void;
}

/** Scene preparation, pipeline prewarm and the half-resolution seabed capture. */
export const createScenePasses = (deps: ScenePassDeps) => {
  let groundRoot: Object3D | null = null;
  let mainScene: Scene | null = null;
  let waterRoot: Object3D | null = null;

  const prepareScene = (scene: Scene) => {
    scene.traverse(object => {
      const category = object.userData[SPIKE_CATEGORY_KEY];
      if (category === "water") waterRoot = object;
      if (category === "terrain") groundRoot = object;
    });
    scene.environment = null;
    scene.background = null;
    // No background pass: the ported sky materials paint every sky pixel, and a background pass
    // would overdraw the possessed sky scene drawn before the world.
    (scene as { backgroundNode?: unknown }).backgroundNode = null;
    scene.traverse(object => {
      if ((object as { isLight?: boolean }).isLight === true) (object as { castShadow?: boolean }).castShadow = false;
    });
    deps.replaceSceneMaterials(scene);
  };

  /** Pipelines depend on the target formats: compile into the post chain's scene target when it runs. */
  const prewarmScenes = async (scenes: readonly Scene[], camera: Camera) => {
    const previous = deps.renderer.getRenderTarget();
    deps.renderer.setRenderTarget(deps.ensurePost()?.scene.target ?? null);
    try { return await prewarmPipelines(deps.renderer, scenes, camera, deps.packer.swapIn); }
    finally { deps.renderer.setRenderTarget(previous); }
  };

  /** Half-resolution seabed capture: only the terrain root, so no water or above-water props. */
  const renderRefraction = (camera: Camera) => {
    if (mainScene === null || groundRoot === null || waterRoot === null) return;
    const drawing = deps.renderer.getDrawingBufferSize(new Vector2());
    const width = Math.max(1, Math.floor(drawing.x * 0.5));
    const height = Math.max(1, Math.floor(drawing.y * 0.5));
    if (deps.refractionTarget.width !== width || deps.refractionTarget.height !== height)
      deps.refractionTarget.setSize(width, height);
    const previousClear = new Color();
    deps.renderer.getClearColor(previousClear);
    const previousAlpha = deps.renderer.getClearAlpha();
    deps.renderer.setRenderTarget(deps.refractionTarget);
    deps.renderer.setClearColor(0x000000, 0);
    deps.renderer.clear();
    const restore = deps.packer.swapIn(mainScene);
    // GLSL captures ungraded linear radiance (colorIsLinearCapture); the water grades the bed once.
    surfaceLinearCapture.value = 1;
    try {
      camera.updateMatrixWorld();
      deps.renderer.render(groundRoot as unknown as Scene, camera);
    } finally {
      surfaceLinearCapture.value = 0;
      restore();
    }
    deps.renderer.setClearColor(previousClear, previousAlpha);
    deps.renderer.setRenderTarget(null);
  };

  return {
    isMainScene: (scene: Scene) => scene === mainScene,
    prepareScene,
    prewarmScenes,
    renderRefraction,
    setMainScene: (scene: Scene | null) => { mainScene = scene; }
  };
};

export type ScenePasses = ReturnType<typeof createScenePasses>;
