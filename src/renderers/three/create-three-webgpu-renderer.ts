import type { CreateRenderer, RendererModule } from "../../render-common/renderer-contract";

/**
 * WG-0 wrapper: the only module the app loads for `?renderer=webgpu|webgpu-gl`. It adds the node
 * presenter to the normal scene builder and keeps the WebGL2 renderer as the fallback.
 */
export const createWebGpuRenderer: CreateRenderer = async input => {
  const [{ createThreeRendererWithWebGpuSpike }, { createWebGpuPresenter }] = await Promise.all([
    import("./create-three-renderer"),
    import("./webgpu/webgpu-spike-presenter")
  ]);
  return createThreeRendererWithWebGpuSpike(input, {
    presenter: createWebGpuPresenter,
    rendererMode: input.rendererMode === "webgpu-gl" ? "webgpu-gl" : "webgpu"
  });
};

export const rendererModule: RendererModule = {
  create: createWebGpuRenderer,
  prefetch: input => {
    void import("./create-three-renderer").then(module => module.rendererModule.prefetch?.(input));
  }
};
