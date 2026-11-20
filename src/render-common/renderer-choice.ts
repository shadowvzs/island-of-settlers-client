/**
 * Renderer selection for the WebGPU migration spike (WG-0). The WebGL2 renderer stays the
 * default; the WebGPU choices are development switches, selected by `?renderer=` or the hidden
 * admin/dev setting in `readDevParams`.
 */
export type RendererChoice = "webgl" | "webgpu" | "webgpu-gl";

export const RENDERER_CHOICES: readonly RendererChoice[] = ["webgl", "webgpu", "webgpu-gl"];

/** The WebGPU spike choices render through the node system; `webgpu-gl` forces its WebGL2 backend. */
export const isWebGpuChoice = (choice: RendererChoice) => choice !== "webgl";

export const readRendererChoice = (value: string | null): RendererChoice => {
  if (value === "webgpu" || value === "webgpu-gl") return value;
  return "webgl";
};

/** Hidden admin/dev setting: the last explicit choice is kept for the next dev reload. */
export const RENDERER_CHOICE_STORAGE_KEY = "island.renderer";
