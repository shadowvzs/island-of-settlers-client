import { expect, it, vi } from "vitest";

import { createRiderBodyOwner } from "../src/renderers/three/mount-rider-body-owner";

it("shares the full source between ordinary and Commander bodies, retaining their distinct far surfaces", async () => {
  const load = vi.fn(async (url: string) => ({ url })), dispose = vi.fn();
  const owner = createRiderBodyOwner(load, dispose, true);
  const [ordinary, commander] = await Promise.all([owner.load("full", "ordinary"), owner.load("full", "commander")]);
  expect(load.mock.calls.map(([url]) => url).sort((a, b) => a.localeCompare(b))).toEqual(["commander", "full", "ordinary"]);
  expect(commander.model).toBe(ordinary.model);
  ordinary.release(); ordinary.release();
  expect(dispose.mock.calls.map(([body]) => body.url)).toEqual(["ordinary"]);
  commander.release(); await Promise.resolve();
  expect(dispose.mock.calls.map(([body]) => String(body.url)).sort((a, b) => a.localeCompare(b))).toEqual(["commander", "full", "ordinary"]);
  owner.dispose(); expect(dispose).toHaveBeenCalledTimes(3);
});

it("Minimal loads only the selected body and disposal drains an in-flight source exactly once", async () => {
  let complete!: (body: { url: string }) => void;
  const load = vi.fn(() => new Promise<{ url: string }>(resolve => { complete = resolve; })), dispose = vi.fn();
  const owner = createRiderBodyOwner(load, dispose, false), pending = owner.load("full", "commander");
  await Promise.resolve(); owner.dispose(); complete({ url: "commander" });
  await expect(pending).rejects.toThrow("released before it finished loading");
  expect(load.mock.calls).toEqual([["commander"]]); expect(dispose).toHaveBeenCalledTimes(1);
});

it("releases a late successful sibling when the other body fails", async () => {
  let complete!: (body: { url: string }) => void;
  const dispose = vi.fn(), owner = createRiderBodyOwner(url => url === "full"
    ? new Promise<{ url: string }>(resolve => { complete = resolve; }) : Promise.reject(new Error("far failed")), dispose, true);
  await expect(owner.load("full", "commander")).rejects.toThrow("far failed");
  complete({ url: "full" }); await Promise.resolve(); await Promise.resolve();
  expect(dispose.mock.calls).toEqual([[{ url: "full" }]]);
  owner.dispose(); expect(dispose).toHaveBeenCalledTimes(1);
});
