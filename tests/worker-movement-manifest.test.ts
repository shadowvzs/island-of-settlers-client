import { describe, expect, it } from "vitest";

import { validateSavedActors } from "../src/shared/settlement/settlement-save-actors";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";
import { ensureWorkerMovementPlan } from "../src/shared/settlement/settlement-worker-movement-plan";

const context = {
  navigationRevision: 1,
  buildings: [],
  options: { roads: { revision: 2 }, world: { buildRevision: 3, terrainRevision: 4 } },
  clock: { tick: () => 100 }
} as unknown as SettlementContext;

const movingActor = (overrides: Partial<SettlementActor> = {}) => ({
  phase: "deliver",
  x: 0,
  z: 0,
  locomotionSpeed: 1,
  path: [{ x: 0, z: 0 }, { x: 10, z: 0 }],
  ...overrides
} as unknown as SettlementActor);

const delivery = { source: 7, destination: 9, ware: "logs" };

describe("worker movement manifest", () => {
  it("carries the active delivery manifest and destination claim before pickup", () => {
    const plan = ensureWorkerMovementPlan(context, movingActor({ delivery }))!;
    expect(plan.manifest).toEqual({ source: 7, destination: 9, ware: "logs", units: 1,
      fleet: "cartless", capacity: 1 });
    expect(plan.claims).toEqual({ source: false, destination: true });
  });

  it("claims the source once the carrier grips the ware", () => {
    const actor = movingActor({ delivery, ware: "logs", wareUnits: 2 });
    const plan = ensureWorkerMovementPlan(context, actor)!;
    expect(plan.manifest).toEqual({ source: 7, destination: 9, ware: "logs", units: 2,
      fleet: "cartless", capacity: 2 });
    expect(plan.claims).toEqual({ source: true, destination: true });
  });

  it("refreshes the source claim on plan reuse after pickup", () => {
    const actor = movingActor({ delivery });
    const plan = ensureWorkerMovementPlan(context, actor)!;
    expect(plan.claims).toEqual({ source: false, destination: true });
    actor.ware = "logs";
    expect(ensureWorkerMovementPlan(context, actor)).toBe(plan);
    expect(plan.claims).toEqual({ source: true, destination: true });
  });

  it("updates the manifest when a reused plan gets a different delivery", () => {
    const actor = movingActor({ delivery });
    const plan = ensureWorkerMovementPlan(context, actor)!;
    actor.delivery = { source: 11, destination: 13, ware: "planks" };
    expect(ensureWorkerMovementPlan(context, actor)).toBe(plan);
    expect(plan.manifest).toEqual({ source: 11, destination: 13, ware: "planks", units: 1,
      fleet: "cartless", capacity: 1 });
    expect(plan.claims).toEqual({ source: false, destination: true });
  });

  it("keeps a non-carrier plan without a manifest", () => {
    const actor = movingActor({ delivery: undefined, job: "Woodcutter" });
    const plan = ensureWorkerMovementPlan(context, actor)!;
    expect(plan.manifest).toBeUndefined();
    expect(plan.claims).toBeUndefined();
    expect("manifest" in plan).toBe(false);
  });

  it("snapshots the destination claim lease with the plan claims", () => {
    const actor = movingActor({ delivery: { ...delivery, leaseStartedTick: 50,
      leaseDeadlineTick: 650 } });
    const plan = ensureWorkerMovementPlan(context, actor)!;
    expect(plan.claims).toEqual({ source: false, destination: true,
      leaseStartedTick: 50, leaseDeadlineTick: 650 });
  });

  it("records a handcart manifest with the cart capacity, not the single hand-held unit", () => {
    const actor = movingActor({
      handcart: { cargo: 0, owner: 0, state: "hitched", trip: {
        source: 7, destination: 9, ware: "logs", planned: 3, loaded: 0, delivered: 0, prepaid: 0,
        capacity: 3, leaseStartedTick: 50, leaseDeadlineTick: 650
      } }
    });
    const plan = ensureWorkerMovementPlan(context, actor)!;
    expect(plan.manifest).toEqual({ source: 7, destination: 9, ware: "logs", units: 3,
      fleet: "handcart", capacity: 3 });
    expect(plan.claims).toEqual({ source: false, destination: true,
      leaseStartedTick: 50, leaseDeadlineTick: 650 });
  });
});

const ids = new Set([0, 1]);
interface MutablePlan {
  claims: { destination: boolean; source: boolean; leaseDeadlineTick?: number;
    leaseStartedTick?: number };
  manifest: { capacity?: number; destination: number; fleet?: string; source: number;
    units: number; ware: string };
}
const planOf = (actor: ReturnType<typeof savedActor>) =>
  actor.workerMovementPlan as unknown as MutablePlan;
const savedActor = (job = "Carrier") => ({
  uid: 12,
  x: 0,
  z: 0,
  y: 0,
  yaw: 0,
  visible: true,
  action: "walk",
  job,
  phase: "deliver",
  path: [{ x: 0, z: 0 }, { x: 1, z: 0 }],
  pathIndex: 0,
  timer: 0,
  animationTime: 0,
  home: 0,
  building: 1,
  ware: "logs",
  workerMovementPlan: {
    phase: "deliver",
    pathLength: 1,
    revision: "1/2/3/4/0",
    startedTick: 0,
    expectedArriveTick: 20,
    lastSafePoint: { x: 0, z: 0 },
    target: { x: 1, z: 0 },
    status: "moving",
    ware: "logs",
    wareUnits: 1,
    manifest: { source: 0, destination: 1, ware: "logs", units: 1,
      fleet: "cartless" as const, capacity: 1 },
    claims: { source: true, destination: true, leaseStartedTick: 0, leaseDeadlineTick: 600 }
  }
});

describe("worker movement manifest save validation", () => {
  it("accepts a manifest that matches the plan cargo", () => {
    expect(validateSavedActors([savedActor()], ids, new Set())).toBeNull();
  });

  it("rejects a manifest whose ware disagrees with the plan", () => {
    const actor = savedActor();
    actor.workerMovementPlan.manifest.ware = "planks";
    expect(validateSavedActors([actor], ids, new Set())).toBe("Invalid worker movement plan");
  });

  it("rejects a manifest whose units disagree with the plan", () => {
    const actor = savedActor();
    actor.workerMovementPlan.manifest.units = 2;
    expect(validateSavedActors([actor], ids, new Set())).toBe("Invalid worker movement plan");
  });

  it("rejects non-boolean claims", () => {
    const actor = savedActor();
    (actor.workerMovementPlan.claims as unknown as Record<string, unknown>).source = "yes";
    expect(validateSavedActors([actor], ids, new Set())).toBe("Invalid worker movement plan");
  });

  it("keeps a planless non-carrier valid", () => {
    const actor = savedActor("Woodcutter") as Record<string, unknown>;
    delete actor.workerMovementPlan;
    expect(validateSavedActors([actor], ids, new Set())).toBeNull();
  });

  it("accepts a valid claim lease and a handcart manifest whose units ride on the cart", () => {
    const actor = savedActor(), plan = planOf(actor);
    plan.claims = { source: false, destination: true,
      leaseStartedTick: 10, leaseDeadlineTick: 610 };
    plan.manifest = { source: 0, destination: 1, ware: "logs", units: 3,
      fleet: "handcart", capacity: 3 };
    expect(validateSavedActors([actor], ids, new Set())).toBeNull();
  });

  it("rejects a claim lease that expires before it starts", () => {
    const actor = savedActor(), plan = planOf(actor);
    plan.claims = { source: true, destination: true,
      leaseStartedTick: 610, leaseDeadlineTick: 10 };
    expect(validateSavedActors([actor], ids, new Set()))
      .toBe("Invalid worker movement plan");
  });

  it("rejects a cartless manifest that claims more than the single carrier slot", () => {
    const actor = savedActor();
    planOf(actor).manifest = { source: 0, destination: 1, ware: "logs", units: 1,
      fleet: "cartless", capacity: 2 };
    expect(validateSavedActors([actor], ids, new Set()))
      .toBe("Invalid worker movement plan");
  });

  it("rejects a manifest capacity below its selected units", () => {
    const actor = savedActor();
    planOf(actor).manifest = { source: 0, destination: 1, ware: "logs", units: 3,
      fleet: "handcart", capacity: 1 };
    expect(validateSavedActors([actor], ids, new Set()))
      .toBe("Invalid worker movement plan");
  });

  it("rejects a fleet snapshot without a capacity or an unknown fleet", () => {
    const withoutCapacity = savedActor();
    planOf(withoutCapacity).manifest.fleet = "handcart";
    delete planOf(withoutCapacity).manifest.capacity;
    expect(validateSavedActors([withoutCapacity], ids, new Set()))
      .toBe("Invalid worker movement plan");
    const unknown = savedActor(), plan = planOf(unknown);
    plan.manifest.fleet = "wagon";
    plan.manifest.capacity = 1;
    expect(validateSavedActors([unknown], ids, new Set()))
      .toBe("Invalid worker movement plan");
  });
});
