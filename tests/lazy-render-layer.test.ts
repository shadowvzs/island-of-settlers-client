import { expect, it, vi } from "vitest";

import { createLazyRenderLayer } from "../src/renderers/three/lazy-render-layer";

const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };

it("recovers after rejected loading with one in-flight request and bounded backoff", async () => {
  let time = 0;
  const result = { dispose: vi.fn() };
  const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(result);
  const ready = vi.fn(), error = vi.fn();
  const layer = createLazyRenderLayer(load, ready, error, () => time);
  layer.request(); layer.request(); await flush();
  expect(load).toHaveBeenCalledTimes(1);
  expect(error).toHaveBeenCalledTimes(1);
  time = 999; layer.request(); await flush();
  expect(load).toHaveBeenCalledTimes(1);
  time = 1000; layer.request(); layer.request(); await flush();
  expect(load).toHaveBeenCalledTimes(2);
  expect(ready).toHaveBeenCalledWith(result);
  expect(layer.get()).toBe(result);
  layer.dispose(); layer.dispose();
  expect(result.dispose).toHaveBeenCalledTimes(1);
});

it("disposes a late successful load and never retries after disposal", async () => {
  let resolve!: (value: { dispose: () => void }) => void;
  const load = vi.fn(() => new Promise<{ dispose: () => void }>(done => { resolve = done; }));
  const ready = vi.fn(), error = vi.fn(), dispose = vi.fn();
  const layer = createLazyRenderLayer(load, ready, error);
  layer.request(); await flush(); layer.dispose(); resolve({ dispose }); await flush();
  layer.request(); await flush();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(ready).not.toHaveBeenCalled();
  expect(load).toHaveBeenCalledTimes(1);
});

it("caps retry frequency at thirty seconds and reports a repeated outage only once", async () => {
  let time = 0;
  const load = vi.fn().mockRejectedValue(new Error("offline")), error = vi.fn();
  const layer = createLazyRenderLayer(load, vi.fn(), error, () => time);
  for (const start of [0, 1000, 4000, 14000, 44000]) {
    time = start; layer.request(); await flush();
    time++; layer.request(); await flush();
  }
  expect(load).toHaveBeenCalledTimes(5);
  expect(error).toHaveBeenCalledTimes(1);
  layer.dispose(); time = 100000; layer.request(); await flush();
  expect(load).toHaveBeenCalledTimes(5);
});

it("keeps frame preparation pending until its requested layer is usable", async () => {
  let resolve!: (value: { dispose: () => void }) => void;
  const result = { dispose: vi.fn() };
  const layer = createLazyRenderLayer(() => new Promise<{ dispose: () => void }>(done => { resolve = done; }), vi.fn(), vi.fn());
  let prepared = false;
  const preparation = layer.whenReady().then(value => { prepared = true; return value; });
  await flush();
  expect(prepared).toBe(false);
  resolve(result);
  expect(await preparation).toBe(result);
  expect(prepared).toBe(true);
  layer.dispose();
});
