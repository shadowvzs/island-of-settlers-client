import { Matrix4, type Scene, type WebGLRenderer, type WebGLRenderTarget } from "three";

import { getFarStrip, getSlotOrigin, SHADOW_FAR_STRIPS, type ShadowAtlasLayout } from "./shadow-cascades";
import {
  createCascadeCamera,
  drawShadowTile,
  setStaticLayers,
  type ShadowCascadeCamera
} from "./shadow-light-cameras";

export interface FarCascadeDraw {
  calls: number;
  triangles: number;
}

const stripRemap = new Matrix4();

/**
 * The possessed view's last cascade (D7: cached). It freezes a fitted view, rebuilds it quadrant
 * by quadrant in the back slot over SHADOW_FAR_STRIPS frames (each quadrant culled to its own
 * casters), then swaps it in with that view's matrix; the receivers keep reading the previous
 * complete map meanwhile. Sun travel, construction and felling reach the far distance at most that
 * many frames late. With a single slot it is redrawn whole every frame.
 */
export const createFarCascade = (
  index: number,
  { columns, farSlots: slots, tile }: Pick<ShadowAtlasLayout, "columns" | "farSlots" | "tile">
) => {
  const buffered = slots.length > 1;
  const frozen = createCascadeCamera(index);
  const strip = createCascadeCamera(index);
  const published = { halfExtent: 0, matrix: new Matrix4(), slot: slots[0]! };
  let back = slots[buffered ? 1 : 0]!;
  let nextStrip = 0;
  let stale = true;
  const draw = { calls: 0, triangles: 0 };

  const add = (drawn: FarCascadeDraw) => {
    draw.calls += drawn.calls;
    draw.triangles += drawn.triangles;
  };

  const publish = () => {
    published.halfExtent = frozen.halfExtent;
    published.matrix.copy(frozen.matrix);
    published.slot = back;
    if (buffered) back = back === slots[0] ? slots[1]! : slots[0]!;
  };

  const drawStrip = (renderer: WebGLRenderer, target: WebGLRenderTarget, scene: Scene, quadrant: number) => {
    const { offsetX, offsetY, rect } = getFarStrip(quadrant, back, tile, columns);
    strip.copy(frozen);
    stripRemap.makeScale(2, 2, 1).setPosition(offsetX, offsetY, 0);
    strip.camera.projectionMatrix.premultiply(stripRemap);
    setStaticLayers(strip.camera, false);
    add(drawShadowTile(renderer, target, scene, strip.camera, rect));
  };

  const drawWhole = (renderer: WebGLRenderer, target: WebGLRenderTarget, scene: Scene) => {
    const origin = getSlotOrigin(back, tile, columns);
    setStaticLayers(frozen.camera, false);
    add(drawShadowTile(renderer, target, scene, frozen.camera, { height: tile, width: tile, ...origin }));
  };

  return {
    /** The view left the cascades: the next cascade frame rebuilds the far map at once. */
    invalidate: () => { stale = true; },
    /**
     * This frame's far work, given the cascade fitted to the current eye and sun; returns its
     * draws. A whole rebuild on the first frame, when unbuffered, else the next quadrant.
     */
    draw: (
      renderer: WebGLRenderer,
      target: WebGLRenderTarget,
      scene: Scene,
      fitted: ShadowCascadeCamera
    ): FarCascadeDraw => {
      draw.calls = 0;
      draw.triangles = 0;
      if (stale || !buffered) {
        frozen.copy(fitted);
        drawWhole(renderer, target, scene);
        publish();
        stale = false;
        nextStrip = 0;
        return draw;
      }
      if (nextStrip === 0) frozen.copy(fitted);
      drawStrip(renderer, target, scene, nextStrip);
      nextStrip = (nextStrip + 1) % SHADOW_FAR_STRIPS;
      if (nextStrip === 0) publish();
      return draw;
    },
    published
  };
};
