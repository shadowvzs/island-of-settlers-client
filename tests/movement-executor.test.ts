import { describe, expect, it } from "vitest";

import { clearCorridorReservations, corridorReservation } from "../src/shared/settlement/settlement-corridor-reservations";
import {
  advanceMovementExecution, beginMovementExecution, completeMovementExecution,
  movementExecutionEligible, movementExecutionIsCurrent, movementExecutionWake, recoverMovementExecution
} from "../src/shared/settlement/settlement-movement-executor";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";
import { ensureWorkerMovementPlan } from "../src/shared/settlement/settlement-worker-movement-plan";

const context = {
  navigationRevision: 1, buildings: [],
  options: { roads: { revision: 2 }, world: {
    buildRevision: 3, terrainRevision: 4, cellsX: 8, cellsZ: 8,
    heights: new Float32Array(81)
  } },
  clock: { tick: () => 100 }
} as unknown as SettlementContext;
const actor = (uid: number) => ({
  uid, job: "Builder", phase: "outbound", action: "walk", x: 0, z: 0, locomotionSpeed: 1,
  visible: true, ware: null, path: [{ x: 0, z: 0 }, { x: 5, z: 0 }], pathIndex: 0
}) as unknown as SettlementActor;

describe("movement executor", () => {
  it("acquires a corridor and reports the current revision", () => {
    clearCorridorReservations(context);
    const a = actor(1);
    const result = beginMovementExecution(context, a, a.path);
    expect(result.ok).toBe(true);
    expect(corridorReservation(context, a.uid)).toBeDefined();
    const plan = ensureWorkerMovementPlan(context, a)!;
    expect(movementExecutionIsCurrent(context, a, plan.revision)).toBe(true);
  });

  it("holds off a conflicting execution and returns its safe point", () => {
    clearCorridorReservations(context);
    const a = actor(1), b = actor(2);
    expect(beginMovementExecution(context, a, a.path).ok).toBe(true);
    const result = beginMovementExecution(context, b, b.path);
    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(a.uid);
    expect(result.safePoint).toEqual({ x: 0, z: 0 });
  });

  it("holds off a second worker entering the opposite direction", () => {
    clearCorridorReservations(context);
    const a = actor(1), b = actor(2);
    b.path = [{ x: 5, z: 0 }, { x: 0, z: 0 }]; b.x = 5;
    expect(beginMovementExecution(context, a, a.path).ok).toBe(true);
    const result = beginMovementExecution(context, b, b.path);
    expect(result).toMatchObject({ ok: false, conflict: a.uid });
    expect(b.x).toBe(5);
  });

  it("invalidates a stale path revision and releases on recovery", () => {
    clearCorridorReservations(context);
    const revised = { ...context, navigationRevision: 1 } as unknown as SettlementContext;
    const a = actor(1);
    beginMovementExecution(revised, a, a.path);
    revised.navigationRevision = 2;
    expect(movementExecutionWake(revised, a)).toBe("invalidated");
    expect(advanceMovementExecution(revised, a, 1)).toBe("handoff");
    recoverMovementExecution(revised, a);
    expect(corridorReservation(revised, a.uid)).toBeUndefined();
  });

  it("classifies the next executor wake reason", () => {
    clearCorridorReservations(context);
    const a = actor(1);
    beginMovementExecution(context, a, a.path);
    expect(movementExecutionWake(context, a)).toBe("none");
    a.queueWait = 1;
    expect(movementExecutionWake(context, a)).toBe("traffic");
    a.queueWait = 0;
    a.phase = "inputReturn";
    expect(movementExecutionWake(context, a)).toBe("door");
    a.phase = "walk";
    a.pathIndex = a.path.length;
    expect(movementExecutionWake(context, a)).toBe("arrival");
    a.ware = "logs";
    expect(movementExecutionWake(context, a)).toBe("cargo");
  });

  it("advances an empty quiet corridor to the target", () => {
    clearCorridorReservations(context);
    const a = actor(1);
    beginMovementExecution(context, a, a.path);
    expect(advanceMovementExecution(context, a, 6)).toBe("arrived");
    expect(a).toMatchObject({ x: 5, z: 0, pathIndex: 2 });
    expect(a.workerMovementPlan).toBeUndefined();
    expect(corridorReservation(context, a.uid)).toBeUndefined();
  });

  it("eligibility covers hitched cart travel but not loading", () => {
    const cart = actor(2);
    cart.job = "Carrier"; cart.phase = "cartToDestination";
    cart.handcart = { state: "hitched" } as SettlementActor["handcart"];
    expect(movementExecutionEligible(cart)).toBe(true);
    cart.handcart = { state: "parked" } as SettlementActor["handcart"];
    expect(movementExecutionEligible(cart)).toBe(false);
    cart.phase = "cartLoading";
    cart.handcart = { state: "hitched" } as SettlementActor["handcart"];
    expect(movementExecutionEligible(cart)).toBe(false);
  });

  it("hands a body ahead back to the fixed tick while holding the corridor", () => {
    const occupied = {
      ...context,
      actors: [{ uid: 9, visible: true, x: 2, z: 0 }]
    } as unknown as SettlementContext;
    clearCorridorReservations(occupied);
    const a = actor(1);
    beginMovementExecution(occupied, a, a.path);
    expect(advanceMovementExecution(occupied, a, 1)).toBe("handoff");
    expect(corridorReservation(occupied, a.uid)).toBeDefined();
  });

  it("releases the corridor on recovery or completion", () => {
    clearCorridorReservations(context);
    const a = actor(1);
    beginMovementExecution(context, a, a.path);
    expect(recoverMovementExecution(context, a)).toEqual({ x: 0, z: 0 });
    expect(corridorReservation(context, a.uid)).toBeUndefined();
    beginMovementExecution(context, a, a.path);
    completeMovementExecution(context, a);
    expect(corridorReservation(context, a.uid)).toBeUndefined();
    expect(a.workerMovementPlan).toBeUndefined();
  });
});
