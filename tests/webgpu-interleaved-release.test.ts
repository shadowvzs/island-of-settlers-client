import {
  BufferAttribute,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  type WebGPURenderer
} from "three/webgpu";
import { describe, expect, it } from "vitest";

import { releaseInterleavedAttributesWithBuffer } from
  "../src/renderers/three/webgpu/interleaved-attribute-release";

/** A WebGPU backend stand-in: Three's own release (destroy the buffer's GPU buffer, drop the view only). */
const createBackend = (isWebGPUBackend: boolean) => {
  const records = new WeakMap<object, { buffer?: { destroy: () => void; destroyed: boolean } }>();
  const get = (object: object) => {
    let record = records.get(object);
    if (record === undefined) records.set(object, record = {});
    return record;
  };
  const owner = (attribute: object) => (attribute as { data?: object }).data ?? attribute;
  const backend = {
    delete: (object: object) => records.delete(object),
    destroyAttribute: (attribute: object) => {
      get(owner(attribute)).buffer!.destroy();
      records.delete(attribute);
    },
    get,
    isWebGPUBackend
  };
  return { backend, renderer: { backend } as unknown as WebGPURenderer };
};

const createGpuBuffer = () => {
  const buffer = { destroy: () => { buffer.destroyed = true; }, destroyed: false };
  return buffer;
};

describe("WebGPU interleaved attribute release", () => {
  it("drops the shared buffer's record with its destroyed GPU buffer, once for all views", () => {
    const { backend, renderer } = createBackend(true);
    releaseInterleavedAttributesWithBuffer(renderer);
    const shared = new InterleavedBuffer(new Float32Array(10), 5);
    const views = [new InterleavedBufferAttribute(shared, 3, 0), new InterleavedBufferAttribute(shared, 2, 3)];
    const gpu = createGpuBuffer();
    backend.get(shared).buffer = gpu;
    for (const view of views) backend.destroyAttribute(view);
    expect(gpu.destroyed).toBe(true);
    expect(backend.get(shared).buffer).toBeUndefined();
  });

  it("keeps Three's release for plain attributes and on the WebGL2 backend", () => {
    const plain = createBackend(true);
    releaseInterleavedAttributesWithBuffer(plain.renderer);
    const attribute = new BufferAttribute(new Float32Array(3), 3);
    const gpu = createGpuBuffer();
    plain.backend.get(attribute).buffer = gpu;
    plain.backend.destroyAttribute(attribute);
    expect(gpu.destroyed).toBe(true);

    const webgl = createBackend(false);
    const original = webgl.backend.destroyAttribute;
    releaseInterleavedAttributesWithBuffer(webgl.renderer);
    expect(webgl.backend.destroyAttribute).toBe(original);
  });
});
