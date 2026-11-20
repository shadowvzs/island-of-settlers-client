import { expect, it } from "vitest";

import { createHandoffReceipt } from "../src/app/handoff-receipt";

it("records ordered phase durations and resource samples from the injected clock", () => {
  let now = 100;
  const receipt = createHandoffReceipt({ now: () => now });
  now = 125;
  receipt.mark("freeze");
  now = 150;
  receipt.mark("prepare");
  receipt.sample({ gpuObjects: 12, workers: 2 });
  now = 175;
  receipt.mark("install");
  expect(receipt.snapshot()).toMatchObject({
    phases: [
      { atMs: 25, durationMs: 25, phase: "freeze" },
      { atMs: 50, durationMs: 25, phase: "prepare" },
      { atMs: 75, durationMs: 25, phase: "install" }
    ],
    samples: [{ atMs: 50, gpuObjects: 12, workers: 2 }],
    startedAt: 100,
    totalMs: 75
  });
});

it("keeps the receipt bounded and returns copies", () => {
  let now = 0;
  const receipt = createHandoffReceipt({ now: () => now++ });
  for (let index = 0; index < 80; index++) receipt.mark("prepare");
  for (let index = 0; index < 40; index++) receipt.sample({ listeners: index });
  const snapshot = receipt.snapshot();
  expect(snapshot.phases).toHaveLength(64);
  expect(snapshot.phases.at(-1)?.phase).toBe("prepare");
  expect(snapshot.samples).toHaveLength(32);
  expect(snapshot.phases).not.toBe(receipt.snapshot().phases);
});
