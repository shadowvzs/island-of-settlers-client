import type { Camera, Object3D, Scene, WebGLRenderer } from "three";

/**
 * A layer scene whose world matrices an earlier step of the same frame already updated (the layer's
 * own update, or its shadow pass): the main draw skips the renderer's second scene-wide traversal.
 * Objects moved after that update (camera-facing badges) are refreshed alone. Without a mark the
 * draw updates the whole scene as before.
 */
export const createSceneMatrixGate = (scene: Scene) => {
  let current = false;
  return {
    /** Every matrix of the scene is current for this frame's next draw. */
    markCurrent: () => { current = true; },
    /** The scene changed after the mark (a new frame began): the next draw updates everything. */
    invalidate: () => { current = false; },
    render: (renderer: WebGLRenderer, camera: Camera, movedSince: readonly Object3D[] = []) => {
      if (current) for (const object of movedSince) object.updateMatrixWorld();
      scene.matrixWorldAutoUpdate = !current;
      current = false;
      try { renderer.render(scene, camera); }
      finally { scene.matrixWorldAutoUpdate = true; }
    }
  };
};
