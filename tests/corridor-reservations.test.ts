import { describe, expect, it } from "vitest";

import {
  acquireCorridor, clearCorridorReservations, corridorReservation, isCorridorCellReserved, refreshCorridor,
  releaseCorridor
} from "../src/shared/settlement/settlement-corridor-reservations";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";

const context = {
  navigationRevision: 1, buildings: [],
  options: { roads: { revision: 2 }, world: { buildRevision: 3, terrainRevision: 4 } }
} as unknown as SettlementContext;
const actor = (uid: number) => ({ uid, phase: "walk" }) as unknown as SettlementActor;
const path = (from: number, to: number) => [{ x: from, z: 0 }, { x: to, z: 0 }];

describe("corridor reservations", () => {
  it("reserves a sampled corridor and releases it", () => {
    const a = actor(1), b = actor(2);
    clearCorridorReservations(context);
    expect(acquireCorridor(context, a, path(0, 5)).ok).toBe(true);
    expect(corridorReservation(context, a.uid)?.phase).toBe("walk");
    expect(acquireCorridor(context, b, path(3, 8))).toMatchObject({ ok: false, conflict: 1 });
    releaseCorridor(context, a.uid);
    expect(acquireCorridor(context, b, path(3, 8)).ok).toBe(true);
  });

  it("allows a disjoint corridor and reports reserved cells", () => {
    const a = actor(1), b = actor(2);
    clearCorridorReservations(context);
    expect(acquireCorridor(context, a, path(0, 2)).ok).toBe(true);
    expect(acquireCorridor(context, b, path(6, 8)).ok).toBe(true);
    expect(isCorridorCellReserved(context, { x: 1, z: 0 })).toBe(1);
    expect(isCorridorCellReserved(context, { x: 1, z: 0 }, 1)).toBeUndefined();
  });

  it("reserves the cart width, not just the centreline", () => {
    clearCorridorReservations(context);
    const a = actor(1), b = actor(2);
    expect(acquireCorridor(context, a, path(0, 5), "walk", false, .45).ok).toBe(true);
    expect(acquireCorridor(context, b, path(5.3, 8), "walk", false, .25)).toMatchObject({
      ok: false, conflict: 1
    });
  });

  it("does not reserve through a stationary actor", () => {
    const occupied = {
      ...context,
      actors: [{ uid: 9, visible: true, x: 1, z: 0 }]
    } as unknown as SettlementContext;
    clearCorridorReservations(occupied);
    expect(acquireCorridor(occupied, actor(1), path(0, 2))).toMatchObject({
      ok: false, conflict: 9
    });
  });

  it("expires a reservation that its owner stops refreshing", () => {
    let tick = 0;
    const timed = {
      navigationRevision: 1, buildings: [],
      options: { roads: { revision: 2 }, world: { buildRevision: 3, terrainRevision: 4 } },
      clock: { tick: () => tick }
    } as unknown as SettlementContext;
    const a = actor(1);
    clearCorridorReservations(timed);
    expect(acquireCorridor(timed, a, path(0, 2)).ok).toBe(true);
    expect(corridorReservation(timed, a.uid)).toBeDefined();
    tick = 500;
    expect(acquireCorridor(timed, a, path(0, 2)).ok).toBe(true);
    tick = 601;
    expect(corridorReservation(timed, a.uid)).toBeUndefined();
  });

  it("refreshes the lease only when movement calls refresh", () => {
    let tick = 0;
    const timed = {
      navigationRevision: 1, buildings: [],
      options: { roads: { revision: 2 }, world: { buildRevision: 3, terrainRevision: 4 } },
      clock: { tick: () => tick }
    } as unknown as SettlementContext;
    const a = actor(1);
    clearCorridorReservations(timed);
    expect(acquireCorridor(timed, a, path(0, 2)).ok).toBe(true);
    tick = 500; refreshCorridor(timed, a.uid);
    tick = 601;
    expect(corridorReservation(timed, a.uid)).toBeDefined();
  });
});
