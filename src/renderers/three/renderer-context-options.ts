import type { WebGLRendererParameters } from "three";

import type { SceneTarget } from "../../render-common/quality";

/**
 * WebGL context options of the game canvas. The canvas is opaque (`alpha: false`): with an alpha
 * channel the alpha-to-coverage foliage edges would be composited over the page backdrop and show
 * a faint tint. MSAA belongs to the scene target when one is used, so the canvas is then not
 * antialiased itself.
 */
export const getRendererContextOptions = (
  canvas: HTMLCanvasElement,
  antialias: boolean,
  sceneTarget: SceneTarget
): WebGLRendererParameters => ({
  alpha: false,
  antialias: antialias && sceneTarget === "off",
  canvas,
  powerPreference: "high-performance"
});
