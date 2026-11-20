import { expect, it, vi } from "vitest";

import { createHorseTemplateOwner } from "../src/renderers/three/mount-horse-template";

it("keeps the horse template while a static mount holds it", async () => {
  let loaded = 0;
  const load = vi.fn(async () => ({ generation: loaded++ }));
  const dispose = vi.fn();
  const owner = createHorseTemplateOwner(load, dispose);
  const staticMount = owner.acquire();
  const activeMount = owner.acquire();
  const template = await staticMount.promise;
  expect(load).toHaveBeenCalledOnce();
  expect(await activeMount.promise).toBe(template);

  activeMount.release();
  expect(dispose).not.toHaveBeenCalled();
  expect(owner.stats()).toEqual({ assets: 1, pending: 0, references: 1 });

  staticMount.release();
  expect(dispose).toHaveBeenCalledOnce();
  expect(owner.stats()).toEqual({ assets: 0, pending: 0, references: 0 });
});

it("loads the horse template again after the last mount released it", async () => {
  let loaded = 0;
  const load = vi.fn(async () => ({ generation: loaded++ }));
  const owner = createHorseTemplateOwner(load, vi.fn());

  const first = owner.acquire();
  expect((await first.promise).generation).toBe(0);
  first.release();

  const second = owner.acquire();
  expect((await second.promise).generation).toBe(1);
  expect(load).toHaveBeenCalledTimes(2);
  second.release();
});

it("discards a pending horse load released by its last mount", async () => {
  let finish!: (template: { generation: number }) => void;
  const pending = new Promise<{ generation: number }>(resolve => { finish = resolve; });
  const dispose = vi.fn();
  const load = vi.fn()
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce({ generation: 1 });
  const owner = createHorseTemplateOwner(load, dispose);
  const lease = owner.acquire();
  lease.release();
  finish({ generation: 0 });
  await expect(lease.promise).rejects.toThrow(/released/);
  expect(dispose).toHaveBeenCalledOnce();
  expect(owner.stats()).toEqual({ assets: 0, pending: 0, references: 0 });

  // The next re-add starts a fresh load instead of reusing the discarded generation.
  const second = owner.acquire();
  expect((await second.promise).generation).toBe(1);
  expect(load).toHaveBeenCalledTimes(2);
  second.release();
});

it("discards a late horse load after the layer was disposed", async () => {
  let finish!: (template: { generation: number }) => void;
  const pending = new Promise<{ generation: number }>(resolve => { finish = resolve; });
  const dispose = vi.fn();
  const owner = createHorseTemplateOwner(() => pending, dispose);
  const lease = owner.acquire();
  owner.dispose();
  finish({ generation: 0 });
  await expect(lease.promise).rejects.toThrow(/released/);
  expect(dispose).toHaveBeenCalledOnce();
});
