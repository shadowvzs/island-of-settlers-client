import { expect, it } from "vitest";

import { createSettlementRenderFrames } from "../src/app/settlement/settlement-render-frames";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";

const template = { action: "idle_breathe", animationTime: 0, gaitPhase: 0, heading: 0,
  nation: "roman", runBlend: 0, selected: false, target: null, variant: "roman-man-white",
  visible: true, x: 0, y: 0, z: 0 } as WorkerFrame;

/** The render-only harbour porter the fleet creates for a pier loading job. */
const porter = (x: number, z = 0) => ({ action: "carry", animationTime: 3, building: 0, home: 0,
  job: "Carrier", locomotionSpeed: 1.25, path: [], pathIndex: 0, phase: "dockPorter", timer: 0,
  uid: 2_000_000_001, visible: true, ware: "planks", x, y: 0, yaw: 0, z }) as SettlementActor;

it("animates a loaded harbour porter's legs while he walks the pier", () => {
  const render = createSettlementRenderFrames([template]);
  render.updateWorkers([porter(0)], .05, [], .5);
  render.updateWorkers([porter(.6)], .05, [], 1);
  const frame = render.workers.find(worker => worker.actorId === 2_000_000_001)!;
  expect(frame.action).toBe("carry_shoulder");
  expect(frame.standingCarry).toBe(false);
  expect(frame.gaitPhase).toBeGreaterThan(0);
  expect(frame.animationTime).toBeGreaterThan(0);
});

it("keeps the loaded carry pose while the porter stands at the pier end", () => {
  const render = createSettlementRenderFrames([template]);
  render.updateWorkers([porter(2)], .05, [], .5);
  render.updateWorkers([porter(2)], .05, [], 1);
  const frame = render.workers.find(worker => worker.actorId === 2_000_000_001)!;
  expect(frame.action).toBe("carry_shoulder");
  expect(frame.standingCarry).toBe(true);
  expect(frame.gaitPhase).toBe(0);
});
