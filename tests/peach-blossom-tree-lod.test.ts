import { OrthographicCamera, PerspectiveCamera } from "three";
import { expect, it } from "vitest";

import { createPeachBlossomTreeLod } from "../src/renderers/three/plants/peach-blossom-tree-lod";
import { createPeachBlossomTreeTemplates } from "../src/renderers/three/plants/peach-blossom-tree-templates";

it("promotes only large projected in-frame flowers, then restores shared true3D canopy batches", () => {
  const templates = createPeachBlossomTreeTemplates(true);
  const flowers = [{ position: [0, 0, 0] as [number, number, number], radius: .06, pitch: 0, yaw: 0, seed: 0 },
    { position: [3, 0, 0] as [number, number, number], radius: .06, pitch: 0, yaw: 0, seed: 1 }];
  const model = createPeachBlossomTreeLod(flowers, templates, true);
  const camera = new PerspectiveCamera(33, 1.4, .01, 100);
  try {
    model.root.updateMatrixWorld(true);
    camera.position.set(0, .10, .65); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    model.root.update(camera);
    expect(model.snapshot()).toEqual({ hero: 1, canopy: 0, far: 1, heroLimit: 128,
      triangles: templates.heroCost + templates.farCost });
    model.root.update(camera); expect(model.snapshot().hero).toBe(1);
    camera.position.set(0, 3, 20); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    model.root.update(camera);
    expect(model.snapshot()).toEqual({ hero: 0, canopy: 0, far: 2, heroLimit: 128, triangles: templates.farCost * 2 });
    const orthographic = new OrthographicCamera(-.2, .2, .2, -.2, .01, 100);
    orthographic.position.set(0, 1, 20); orthographic.lookAt(0, 0, 0); orthographic.updateMatrixWorld(true);
    model.root.update(orthographic);
    expect(model.snapshot().hero).toBe(1);
    expect(model.snapshot().far).toBe(1);
  } finally { model.dispose(); model.dispose(); templates.dispose(); templates.dispose(); }
});

it("caps the largest projected hero group rather than promoting an entire dense crown", () => {
  const templates = createPeachBlossomTreeTemplates(false);
  const flowers = Array.from({ length: 200 }, (_, seed) => ({
    position: [0, 0, 0] as [number, number, number], radius: .03, pitch: 0, yaw: 0, seed
  }));
  const model = createPeachBlossomTreeLod(flowers, templates, false);
  try {
    const camera = new PerspectiveCamera(33, 1.4, .01, 100);
    camera.position.set(0, 0, .25); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    model.root.updateMatrixWorld(true); model.root.update(camera);
    const state = model.snapshot();
    expect(state.hero).toBe(48); expect(state.canopy).toBe(152); expect(state.far).toBe(0);
    expect(state.triangles).toBe(48 * templates.heroCost + 152 * templates.canopyCost);
  } finally { model.dispose(); templates.dispose(); }
});
