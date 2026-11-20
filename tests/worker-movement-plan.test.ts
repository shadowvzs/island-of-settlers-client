import { describe, expect, it } from "vitest";

import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";
import {
  ensureWorkerMovementPlan, invalidateWorkerMovementPlan, markWorkerMovement
} from "../src/shared/settlement/settlement-worker-movement-plan";

const actor = {
  phase: "walk", x: 0, z: 0, locomotionSpeed: 1,
  path: [{ x: 0, z: 0 }, { x: 10, z: 0 }]
} as unknown as SettlementActor;
const context = {
  navigationRevision: 1, buildings: [],
  options: { roads: { revision: 2 }, world: { buildRevision: 3, terrainRevision: 4 } },
  clock: { tick: () => 100 }
} as unknown as SettlementContext;

describe("worker movement plan", () => {
  it("records deterministic path length, revision and expected arrival", () => {
    const plan = ensureWorkerMovementPlan(context, actor)!;
    expect(plan.pathLength).toBe(10);
    expect(plan.revision).toBe("1/2/3/4/0");
    expect(plan.startedTick).toBe(100);
    expect(plan.expectedArriveTick).toBe(300);
    expect(plan.lastSafePoint).toEqual({ x: 0, z: 0 });
  });

  it("keeps the last safe point while blocked and clears on arrival", () => {
    const plan = ensureWorkerMovementPlan(context, actor)!;
    markWorkerMovement(actor, "moving", { x: 4, z: 0 });
    markWorkerMovement(actor, "blocked", { x: 4, z: 0 });
    expect(plan.status).toBe("blocked");
    expect(plan.lastSafePoint).toEqual({ x: 4, z: 0 });
    markWorkerMovement(actor, "arrived");
    expect(actor.workerMovementPlan).toBeUndefined();
  });

  it("replaces an invalidated plan on the next movement", () => {
    actor.path = [{ x: 0, z: 0 }, { x: 2, z: 0 }];
    const first = ensureWorkerMovementPlan(context, actor)!;
    invalidateWorkerMovementPlan(actor);
    const second = ensureWorkerMovementPlan(context, actor)!;
    expect(second).not.toBe(first);
    expect(second.status).toBe("planned");
  });
});
