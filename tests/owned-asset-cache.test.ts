import { expect, it, vi } from "vitest";

import { createOwnedAssetCache } from "../src/renderers/three/owned-asset-cache";

it("shares one asset and disposes it with the last lease", async () => {
  const dispose = vi.fn();
  const load = vi.fn(async (key: string) => ({ key }));
  const cache = createOwnedAssetCache(load, dispose);
  const first = cache.acquire("alpha");
  const second = cache.acquire("alpha");
  expect(await first.promise).toBe(await second.promise);
  expect(load).toHaveBeenCalledOnce();
  first.release();
  expect(dispose).not.toHaveBeenCalled();
  second.release();
  expect(dispose).toHaveBeenCalledOnce();
  expect(cache.stats()).toEqual({ assets: 0, pending: 0, references: 0 });
});

it("discards a late result once its generation was released", async () => {
  let finish!: (asset: { key: string }) => void;
  const pending = new Promise<{ key: string }>(resolve => { finish = resolve; });
  const dispose = vi.fn();
  const cache = createOwnedAssetCache(() => pending, dispose);
  const lease = cache.acquire("alpha");
  lease.release();
  expect(cache.stats()).toEqual({ assets: 0, pending: 0, references: 0 });
  finish({ key: "alpha" });
  await expect(lease.promise).rejects.toThrow(/released/);
  expect(dispose).toHaveBeenCalledOnce();
  expect(cache.stats()).toEqual({ assets: 0, pending: 0, references: 0 });
});

it("loads a type again after its generation was released", async () => {
  let next = 0;
  const cache = createOwnedAssetCache(async () => ({ generation: next++ }), vi.fn());
  const first = cache.acquire("alpha");
  expect(await first.promise).toEqual({ generation: 0 });
  first.release();
  const second = cache.acquire("alpha");
  expect(await second.promise).toEqual({ generation: 1 });
  second.release();
});

it("does not release another owner's asset when one lease is released twice", async () => {
  const dispose = vi.fn();
  const cache = createOwnedAssetCache(async () => ({ geometry: "shared" }), dispose);
  const first = cache.acquire("body");
  const second = cache.acquire("body");
  const asset = await second.promise;

  first.release();
  first.release();

  expect(dispose).not.toHaveBeenCalled();
  expect(cache.stats()).toEqual({ assets: 1, pending: 0, references: 1 });
  expect(await second.promise).toBe(asset);
  second.release();
  second.release();
  expect(dispose).toHaveBeenCalledExactlyOnceWith(asset);
  expect(cache.stats()).toEqual({ assets: 0, pending: 0, references: 0 });
});

it("keeps a sibling pending load alive after repeated release of one lease", async () => {
  let finish!: (asset: { geometry: string }) => void;
  const pending = new Promise<{ geometry: string }>(resolve => { finish = resolve; });
  const dispose = vi.fn();
  const cache = createOwnedAssetCache(() => pending, dispose);
  const first = cache.acquire("body");
  const second = cache.acquire("body");

  first.release();
  first.release();
  const asset = { geometry: "shared" };
  finish(asset);

  await expect(second.promise).resolves.toBe(asset);
  expect(dispose).not.toHaveBeenCalled();
  expect(cache.stats()).toEqual({ assets: 1, pending: 0, references: 1 });
  second.release();
  expect(dispose).toHaveBeenCalledExactlyOnceWith(asset);
});
