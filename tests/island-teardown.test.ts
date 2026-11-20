import { expect, it, vi } from "vitest";

import { createIslandTeardown } from "../src/app/island-teardown";

it("releases owners in phase order and keeps insertion order inside a phase", async () => {
  const calls: string[] = [];
  const teardown = createIslandTeardown([
    { dispose: () => { calls.push("renderer"); }, name: "renderer", phase: "renderer" },
    { dispose: () => { calls.push("audio"); }, name: "audio", phase: "audio" },
    { dispose: () => { calls.push("ui-one"); }, name: "ui-one", phase: "settlement-ui" },
    { dispose: () => { calls.push("loop"); }, name: "loop", phase: "stop-producers" },
    { dispose: () => { calls.push("ui-two"); }, name: "ui-two", phase: "settlement-ui" },
    { dispose: () => { calls.push("recorder"); }, name: "recorder", phase: "recorders" }
  ]);
  expect(await teardown.run()).toMatchObject({
    completed: ["loop", "recorder", "ui-one", "ui-two", "audio", "renderer"],
    errors: []
  });
  expect(calls).toEqual(["loop", "recorder", "ui-one", "ui-two", "audio", "renderer"]);
});

it("awaits sequential owners and continues after a failure", async () => {
  const calls: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>(done => { release = done; });
  const teardown = createIslandTeardown([
    { dispose: async () => { calls.push("first"); await blocked; }, name: "first", phase: "controls" },
    { dispose: () => { calls.push("broken"); throw new Error("no"); }, name: "broken", phase: "settlement-ui" },
    { dispose: () => { calls.push("renderer"); }, name: "renderer", phase: "renderer" }
  ]);
  const running = teardown.run();
  await Promise.resolve();
  expect(calls).toEqual(["first"]);
  release();
  expect(await running).toMatchObject({
    completed: ["first", "renderer"],
    errors: [{ name: "broken" }]
  });
  expect(calls).toEqual(["first", "broken", "renderer"]);
  expect((await running).completed).toEqual(["first", "renderer"]);
});

it("runs once even when teardown is requested repeatedly", async () => {
  const dispose = vi.fn();
  const teardown = createIslandTeardown([
    { dispose, name: "one", phase: "island-owners" }
  ]);
  const first = teardown.run();
  const second = teardown.run();
  expect(first).toBe(second);
  await first;
  await teardown.run();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(teardown.steps()).toEqual([{ name: "one", phase: "island-owners" }]);
});
