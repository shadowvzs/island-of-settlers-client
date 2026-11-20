import { expect, it, vi } from "vitest";

import { loadOwnedAssetPair } from "../src/renderers/three/load-owned-asset-pair";

it("releases a successful first resource when its sibling fails", async () => {
  const disposeFirst = vi.fn(), disposeSecond = vi.fn();
  await expect(loadOwnedAssetPair(Promise.resolve("model"), Promise.reject(new Error("mask")),
    disposeFirst, disposeSecond)).rejects.toThrow("mask");
  expect(disposeFirst).toHaveBeenCalledExactlyOnceWith("model");
  expect(disposeSecond).not.toHaveBeenCalled();
});

it("waits for and releases a late successful resource after the first resource rejects", async () => {
  let resolve!: (value: string) => void;
  const disposeFirst = vi.fn(), disposeSecond = vi.fn();
  const pair = loadOwnedAssetPair(Promise.reject(new Error("model")),
    new Promise<string>(done => { resolve = done; }), disposeFirst, disposeSecond);
  resolve("animations");
  await expect(pair).rejects.toThrow("model");
  expect(disposeSecond).toHaveBeenCalledExactlyOnceWith("animations");
  expect(disposeFirst).not.toHaveBeenCalled();
});

it("retains both resources on success", async () => {
  const dispose = vi.fn();
  await expect(loadOwnedAssetPair(Promise.resolve("horse"), Promise.resolve("mask"), dispose, dispose))
    .resolves.toEqual(["horse", "mask"]);
  expect(dispose).not.toHaveBeenCalled();
});
