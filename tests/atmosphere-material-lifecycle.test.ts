import { Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, type WebGLRenderer } from "three";
import { describe, expect, it, vi } from "vitest";

import { createSharedUniformValues } from "../src/render-common/shader-uniforms";
import { createStandardAtmosphereBinding } from "../src/renderers/three/atmosphere/standard-atmosphere";
import { createThreeUniforms } from "../src/renderers/three/three-materials";

describe("atmosphere material replacement and retirement", () => {
  it("binds a replacement before submission without traversing the scene again", () => {
    const camera = new PerspectiveCamera();
    const scene = new Scene();
    const mesh = new Mesh(undefined, new MeshStandardMaterial());
    const previousRenderHook = vi.fn();
    mesh.onBeforeRender = previousRenderHook;
    scene.add(mesh);
    const renderer = { render: vi.fn() } as unknown as WebGLRenderer;
    const binding = createStandardAtmosphereBinding(renderer, createThreeUniforms(createSharedUniformValues()));
    const traverse = vi.spyOn(scene, "traverse");
    renderer.render(scene, camera);
    expect(traverse).toHaveBeenCalledOnce();
    const original = mesh.material;
    const replacement = new MeshStandardMaterial();
    const initialVersion = replacement.version;
    mesh.material = replacement;
    mesh.onBeforeRender(renderer, scene, camera, mesh.geometry, replacement, null!);
    expect(previousRenderHook).toHaveBeenCalledOnce();
    expect(replacement.version).toBeGreaterThan(initialVersion);
    expect(binding.stats.materials).toBe(2);
    renderer.render(scene, camera);
    expect(traverse).toHaveBeenCalledOnce();
    binding.dispose();
    expect(mesh.onBeforeRender).toBe(previousRenderHook);
    original.dispose(); replacement.dispose(); mesh.geometry.dispose();
  });

  it("releases listeners and disposed actor materials while the renderer remains alive", () => {
    const camera = new PerspectiveCamera();
    const scene = new Scene();
    const renderer = { render: vi.fn() } as unknown as WebGLRenderer;
    const binding = createStandardAtmosphereBinding(renderer, createThreeUniforms(createSharedUniformValues()));
    renderer.render(scene, camera);
    for (let index = 0; index < 40; index++) {
      const material = new MeshStandardMaterial();
      const mesh = new Mesh(undefined, material);
      const renderHook = mesh.onBeforeRender;
      scene.add(mesh);
      expect(binding.stats.materials).toBe(1);
      scene.remove(mesh);
      expect(mesh.onBeforeRender).toBe(renderHook);
      material.dispose(); mesh.geometry.dispose();
      expect(binding.stats.materials).toBe(0);
      expect(binding.stats.watchedObjects).toBe(1);
    }
    binding.dispose();
    expect(binding.stats).toEqual({ materials: 0, scenes: 0, watchedObjects: 0 });
  });
});
