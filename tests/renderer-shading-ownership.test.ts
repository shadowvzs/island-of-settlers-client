import { DataTexture, type IUniform, Texture, WebGLRenderTarget } from "three";
import { expect, it, vi } from "vitest";

import { createRendererShadingDisposal } from "../src/renderers/three/three-renderer-shading";

it("releases island shading maps, late water field and render targets once without releasing borrowed bindings", () => {
  const pixels = new Uint8Array([1, 2, 3, 255]);
  const albedo = new DataTexture(pixels, 1, 1), normal = new Texture(), fog = new Texture();
  const waterField = new Texture(), borrowed = new Texture(), refraction = new WebGLRenderTarget(1, 1);
  const shadows = { dispose: vi.fn() };
  const uniforms: Record<string, IUniform> = { uFogMap: { value: fog }, uNoiseTexture: { value: fog },
    uShadowMap: { value: borrowed }, uRefraction: { value: refraction.texture }, uWaterField: { value: null } };
  const release = new Map([albedo, normal, fog, waterField, borrowed].map(texture => {
    const listener = vi.fn(); texture.addEventListener("dispose", listener); return [texture, listener] as const;
  }));
  const releaseTarget = vi.fn(); refraction.addEventListener("dispose", releaseTarget);
  const owner = createRendererShadingDisposal({ albedo, normal, refraction, shadows, uniforms });
  owner.ownWaterField(waterField);
  expect(uniforms.uWaterField!.value).toBe(waterField);
  owner.dispose(); owner.dispose();
  for (const texture of [albedo, normal, fog, waterField]) {
    expect(release.get(texture)).toHaveBeenCalledOnce();
    expect(texture.image).toBeNull();
  }
  expect(release.get(borrowed)).not.toHaveBeenCalled();
  expect(uniforms.uShadowMap!.value).toBe(borrowed);
  expect(uniforms.uRefraction!.value).toBe(refraction.texture);
  expect(uniforms.uFogMap!.value).toBeNull(); expect(uniforms.uWaterField!.value).toBeNull();
  expect(releaseTarget).toHaveBeenCalledOnce(); expect(shadows.dispose).toHaveBeenCalledOnce();
  expect([...pixels]).toEqual([1, 2, 3, 255]); borrowed.dispose();
});

it("keeps ownership of an original texture after rebinding and rejects late allocations after disposal", () => {
  const original = new Texture(), rebound = new Texture(), late = new Texture();
  const releaseOriginal = vi.fn(), releaseRebound = vi.fn(), releaseLate = vi.fn();
  original.addEventListener("dispose", releaseOriginal); rebound.addEventListener("dispose", releaseRebound);
  late.addEventListener("dispose", releaseLate);
  const uniforms = { uFogMap: { value: original }, uWaterField: { value: null } };
  const owner = createRendererShadingDisposal({ albedo: original, normal: original,
    refraction: new WebGLRenderTarget(1, 1), shadows: { dispose: vi.fn() }, uniforms });
  uniforms.uFogMap.value = rebound;
  owner.dispose(); owner.ownWaterField(late);
  expect(releaseOriginal).toHaveBeenCalledOnce(); expect(releaseRebound).not.toHaveBeenCalled();
  expect(uniforms.uFogMap.value).toBe(rebound);
  expect(releaseLate).toHaveBeenCalledOnce(); expect(late.image).toBeNull();
  expect(uniforms.uWaterField.value).toBeNull(); rebound.dispose();
});
