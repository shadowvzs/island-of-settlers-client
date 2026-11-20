import { DataTexture, MeshBasicMaterial, MeshStandardMaterial } from "three";
import { expect, it } from "vitest";

import { watchDisposeListeners } from "../src/renderers/three/renderer-shared-listeners";

/**
 * GPU-LIFECYCLE-03: a page-lifetime material kept one three.js renderer disposer per replaced
 * island, which retained every old renderer. Releasing a renderer must remove only its disposers.
 */
it("detaches a released renderer's disposers from surviving shared materials and textures", () => {
  const rendererDisposer = () => undefined;
  const nextRendererDisposer = () => undefined;
  const appDisposer = () => undefined;
  const release = watchDisposeListeners([rendererDisposer]);
  const releaseNext = watchDisposeListeners([nextRendererDisposer]);
  const shared = new MeshStandardMaterial();
  const sharedTexture = new DataTexture(new Uint8Array(4), 1, 1);
  for (const target of [shared, sharedTexture]) {
    target.addEventListener("dispose", appDisposer);
    target.addEventListener("dispose", rendererDisposer);
    target.addEventListener("dispose", nextRendererDisposer);
  }
  release();
  for (const target of [shared, sharedTexture]) {
    expect(target.hasEventListener("dispose", rendererDisposer)).toBe(false);
    expect(target.hasEventListener("dispose", appDisposer)).toBe(true);
    expect(target.hasEventListener("dispose", nextRendererDisposer)).toBe(true);
  }
  releaseNext();
  expect(shared.hasEventListener("dispose", nextRendererDisposer)).toBe(false);
  expect(shared.hasEventListener("dispose", appDisposer)).toBe(true);
});

it("ignores listeners it does not watch and tolerates already removed disposers", () => {
  const rendererDisposer = () => undefined;
  const release = watchDisposeListeners([rendererDisposer]);
  const material = new MeshBasicMaterial();
  material.addEventListener("dispose", rendererDisposer);
  material.removeEventListener("dispose", rendererDisposer);
  const unwatched = () => undefined;
  material.addEventListener("dispose", unwatched);
  expect(() => release()).not.toThrow();
  expect(material.hasEventListener("dispose", unwatched)).toBe(true);
});
