import { describe, expect, it } from "vitest";

import { createPassThroughNudge } from "../src/app/settlement/pass-through-nudge";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";

const figure = (actorId: number, workerJob: string, x: number, z: number) =>
  ({ actorId, heading: 0, workerJob, x, z } as WorkerFrame);

describe("soldier and worker side step (renderer only)", () => {
  it("eases a soldier and a worker on the same spot apart, and back once they part", () => {
    const nudge = createPassThroughNudge();
    let soldier = figure(1, "Soldier", 5, 5), worker = figure(2, "Carrier", 5, 5);
    for (let frame = 0; frame < 30; frame++) {
      soldier = figure(1, "Soldier", 5, 5); worker = figure(2, "Carrier", 5, 5);
      nudge.apply([soldier, worker], 1 / 60);
    }
    expect(Math.hypot(soldier.x - worker.x, soldier.z - worker.z)).toBeGreaterThan(.45);
    for (let frame = 0; frame < 60; frame++) {
      soldier = figure(1, "Soldier", 5, 5); worker = figure(2, "Carrier", 9, 5);
      nudge.apply([soldier, worker], 1 / 60);
    }
    expect(Math.hypot(soldier.x - 5, soldier.z - 5)).toBeLessThan(.01);
    expect(nudge.offset(1)).toEqual({ x: 0, z: 0 });
  });

  it("leaves workers alone among themselves and soldiers among themselves", () => {
    const nudge = createPassThroughNudge();
    const frames = [figure(1, "Carrier", 5, 5), figure(2, "Builder", 5, 5)];
    nudge.apply(frames, 1 / 60);
    expect(frames.map(frame => frame.x)).toEqual([5, 5]);
    const troops = [figure(3, "Soldier", 5, 5), figure(4, "Soldier", 5.1, 5)];
    nudge.apply(troops, 1 / 60);
    expect(troops.map(frame => frame.x)).toEqual([5, 5.1]);
  });
});
