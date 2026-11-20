import { DataTexture, Vector4 } from "three";
import { describe, expect, it } from "vitest";

import {
  bindComputed,
  bindScalar,
  bindTexture,
  bindVector,
  bindVector3Array,
  createUniformBindings,
  syncUniformBindings
} from "../src/renderers/webgpu/tsl/uniform-bindings";

describe("WG-FIX-C TSL uniform bindings", () => {
  it("re-reads a Vector4 source mutated after the build", () => {
    const lawnDepth = { value: new Vector4(0.1, 0.2, 0.3, 0.4) };
    const bindings = createUniformBindings("test", { uLawnDepth: lawnDepth });
    const node = bindVector(bindings, "uLawnDepth", 4);
    lawnDepth.value.set(0.9, 0.8, 0.7, 0.6);
    syncUniformBindings(bindings);
    expect(node.value.toArray()).toEqual([0.9, 0.8, 0.7, 0.6]);
  });

  it("re-reads array sources in place and after replacement", () => {
    const worldSize = { value: [64, 32] as number[] };
    const bindings = createUniformBindings("test", { uWorldSize: worldSize });
    const node = bindVector(bindings, "uWorldSize", 2);
    worldSize.value[0] = 128;
    syncUniformBindings(bindings);
    expect(node.value.toArray()).toEqual([128, 32]);
    worldSize.value = [256, 512];
    syncUniformBindings(bindings);
    expect(node.value.toArray()).toEqual([256, 512]);
  });

  it("splits a flat vec3 array and keeps scalar fallbacks", () => {
    const sky = { value: new Float32Array(9 * 3) };
    const rain = { value: 0.25 };
    const bindings = createUniformBindings("test", { uRain: rain, uSkyIrradiance: sky });
    const nodes = bindVector3Array(bindings, "uSkyIrradiance", 9);
    const rainNode = bindScalar(bindings, "uRain");
    const liveFog = bindScalar(bindings, "uLiveFog", 0);
    sky.value.set([1, 2, 3], 8 * 3);
    rain.value = 0.75;
    syncUniformBindings(bindings);
    expect(nodes[8].value.toArray()).toEqual([1, 2, 3]);
    expect(rainNode.value).toBe(0.75);
    expect(liveFog.value).toBe(0);
    expect(() => bindVector(bindings, "uMissing", 3)).toThrow("test TSL: missing uniform uMissing");
  });

  it("follows a replaced texture and a derived value", () => {
    const first = new DataTexture(new Uint8Array(4), 1, 1);
    const second = new DataTexture(new Uint8Array(4), 1, 1);
    const wear = { value: first };
    const toneMapper = { value: 0 };
    const bindings = createUniformBindings("test", { uColorToneMapper: toneMapper, uTrafficWear: wear });
    const texture = bindTexture(bindings, "uTrafficWear");
    const exposure = bindComputed(bindings, () => 1 + toneMapper.value);
    wear.value = second;
    toneMapper.value = 0.5;
    syncUniformBindings(bindings);
    expect(texture.value).toBe(second);
    expect(exposure.value).toBe(1.5);
  });
});
