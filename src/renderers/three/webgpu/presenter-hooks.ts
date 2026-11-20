import type { Camera, Material, Object3D, Scene } from "three";
import type { WebGPURenderer } from "three/webgpu";

export interface GeneratedShaders { fragmentShader: string | null; vertexShader: string | null }

/**
 * TSL-3c: the possessed sky's ported material owns its half-resolution cloud march + resolve
 * (`userData.renderPrepass`), drawn before the sky like the WebGL sky's `renderClouds`. Only the
 * tagged sky scene is looked at; it holds one fullscreen mesh.
 */
const isExplorationSkyScene = (scene: Scene) =>
  (scene.userData as { wgExplorationSkyScene?: boolean }).wgExplorationSkyScene === true;

/** The sky scene's prepass hooks named `key` (one fullscreen mesh; none for other scenes). */
const prepassHooksOf = (scene: Scene, key: "prewarmPrepass" | "renderPrepass") => {
  if (!isExplorationSkyScene(scene)) return [];
  return scene.children.map(child => (child as { material?: Material }).material?.userData[key])
    .filter((hook): hook is (...args: never[]) => unknown => typeof hook === "function");
};

export const renderScenePrepasses = (renderer: WebGPURenderer, scene: Scene, camera: Camera) => {
  for (const prepass of prepassHooksOf(scene, "renderPrepass"))
    (prepass as (renderer: WebGPURenderer, camera: Camera) => void)(renderer, camera);
};

/** Builds the prepass pipelines with the scene's compile (C-3 prewarm): none on the first possessed frame. */
export const prewarmScenePrepasses = (renderer: WebGPURenderer, scene: Scene) => {
  for (const prewarm of prepassHooksOf(scene, "prewarmPrepass"))
    (prewarm as (renderer: WebGPURenderer) => void)(renderer);
};

/**
 * Dev tool (`tools/webgpu/tsl-scope-check.ts`): one pending request for the generated shaders of
 * the next draw with a named node material. `capture` costs one null check per draw while idle.
 */
export const createShaderRequests = (renderer: WebGPURenderer) => {
  let pending: { name: string; resolve: (shaders: Promise<GeneratedShaders>) => void } | null = null;
  return {
    capture: (material: Material, scene: Scene, camera: Camera, object: Object3D) => {
      if (pending === null || material.name !== pending.name) return;
      const request = pending;
      pending = null;
      request.resolve(renderer.debug.getShaderAsync(scene, camera, object as never));
    },
    request: (name: string) => new Promise<GeneratedShaders>(resolve => { pending = { name, resolve }; })
  };
};
