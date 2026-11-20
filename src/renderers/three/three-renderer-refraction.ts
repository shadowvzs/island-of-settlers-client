import type { Camera, Object3D, Scene, Vector2, WebGLRenderer, WebGLRenderTarget } from "three";

import type { RendererInput } from "../../render-common/renderer-contract";
import { withoutRefractionForeground } from "./three-refraction-pass";
import type { createThreeVegetation } from "./three-vegetation";

type RefractionInput = Pick<RendererInput, "quality"> & {
  /** Above-water geometry hidden during the pass (listed on every draw). */
  foreground: () => readonly Object3D[];
  /** False when no water chunk intersects the view: skip the whole capture. */
  hasWater?: (camera: Camera) => boolean;
  /**
   * Hides ground chunks without water during the seabed capture. Returns the restore; the pass
   * calls it even when rendering throws.
   */
  hideWaterlessGround?: () => () => void;
  refraction: WebGLRenderTarget;
  renderer: WebGLRenderer;
  scene: Scene;
  vegetation: Awaited<ReturnType<typeof createThreeVegetation>>;
  viewport: Vector2;
  weedScene: Scene;
  /**
   * Runs the capture without camera air and with linear colour output (the sRGB target holds
   * ungraded seabed radiance), restoring both even when rendering throws.
   */
  asSeabedCapture: (render: () => void) => void;
};

/** Refraction target size for the current drawing buffer (also applied when the renderer resizes). */
export const sizeRefractionTarget = (
  target: WebGLRenderTarget,
  viewport: Vector2,
  scale: number
) => {
  const width = Math.max(1, Math.floor(viewport.x * scale));
  const height = Math.max(1, Math.floor(viewport.y * scale));
  if (target.width !== width || target.height !== height) target.setSize(width, height);
};

/**
 * Seabed and its weeds only (no water, no props) at half size: the water samples it with a
 * wave offset.
 */
export const createRefractionRenderer = ({
  asSeabedCapture,
  foreground,
  hasWater = () => true,
  hideWaterlessGround,
  quality,
  refraction,
  renderer,
  scene,
  vegetation,
  viewport,
  weedScene
}: RefractionInput) => (camera: Camera) => {
  if (!hasWater(camera)) return;
  sizeRefractionTarget(refraction, viewport, quality.refractionScale);
  const restore = vegetation.hideForRefraction();
  const restoreWaterless = hideWaterlessGround?.() ?? (() => undefined);
  try {
    asSeabedCapture(() => {
      withoutRefractionForeground(foreground(), () => {
        renderer.setRenderTarget(refraction);
        renderer.clear();
        renderer.render(scene, camera);
        renderer.render(weedScene, camera);
      });
    });
  } finally {
    restoreWaterless();
    renderer.setRenderTarget(null);
    restore();
  }
};
