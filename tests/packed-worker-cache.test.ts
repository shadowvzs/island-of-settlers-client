import { expect, it } from "vitest";

import { packWorkerValue, unpackWorkerValue } from "../src/app/packed-worker-cache";

it("round trips typed views, preserving offsets, values and shared backing buffers", () => {
  const backing = new ArrayBuffer(24);
  const values = new Float32Array(backing, 8, 3); values.set([1.5, -2.25, 123]);
  const input = { species: [{ mask: new Uint8Array(backing, 1, 3), values }],
    indices: new Uint16Array([0, 3, 65535]), clamp: new Uint8ClampedArray([255]), label: "nav" };
  const result = unpackWorkerValue<typeof input>(structuredClone(packWorkerValue(input)));
  expect(result).toEqual(input);
  expect(result.species[0]!.mask.buffer).toBe(result.species[0]!.values.buffer);
  expect(result.species[0]!.values.byteOffset % 4).toBe(0);
  expect(result.indices).toBeInstanceOf(Uint16Array);
  expect(result.clamp).toBeInstanceOf(Uint8ClampedArray);
});
