import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type * as ReservationWatchdog from "../src/shared/settlement/settlement-reservation-watchdog";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";

vi.mock("../src/shared/settlement/settlement-traffic", () => ({
  actorSeparation: () => .35,
  chooseYieldTarget: () => ({ x: 2, z: 2 }),
  isShoveableIdler: (actor: { job: string }) => actor.job === "Carrier",
  setQueueTarget: (actor: { queueTarget?: unknown }, point: unknown) => { actor.queueTarget = point; }
}));

let updateReservationWatchdogs: typeof ReservationWatchdog.updateReservationWatchdogs;
let watchReservation: typeof ReservationWatchdog.watchReservation;
// isolate:false shares the module cache: load the subject fresh so it sees this file's mocks,
// then drop the mocks and the mocked graph so later files of the worker get the real modules.
beforeAll(async () => {
  vi.resetModules();
  ({ updateReservationWatchdogs, watchReservation } =
    await import("../src/shared/settlement/settlement-reservation-watchdog"));
});
afterAll(() => {
  vi.doUnmock("../src/shared/settlement/settlement-traffic");
  vi.resetModules();
});

const fixture = (job = "Carrier") => {
  const owner = { uid: 1, x: 0, z: 0, visible: true, pathIndex: 0, path: [{ x: .4, z: 0 }] } as SettlementActor;
  const blocker = { uid: 2, x: .4, z: 0, visible: true, job } as SettlementActor;
  const context = { actors: [owner, blocker] } as SettlementContext;
  const release = vi.fn();
  let valid = true;
  watchReservation(context, "court:1", owner, () => valid, release);
  return { blocker, context, invalidate: () => { valid = false; }, owner, release };
};

describe("reservation progress watchdog", () => {
  it("moves an allowed blocker after four seconds and releases a stuck owner after eight", () => {
    const { blocker, context, release } = fixture();
    updateReservationWatchdogs(context, 3.9);
    expect(blocker.queueTarget).toBeUndefined();
    updateReservationWatchdogs(context, .1);
    expect(blocker.queueTarget).toEqual({ x: 2, z: 2 });
    expect(release).not.toHaveBeenCalled();
    updateReservationWatchdogs(context, 4);
    expect(release).toHaveBeenCalledOnce();
    updateReservationWatchdogs(context, 20);
    expect(release).toHaveBeenCalledOnce();
  });

  it("recovers an owner that reached its approach but is blocked before admission", () => {
    const { context, owner, release } = fixture();
    owner.path = [];
    watchReservation(context, "court:1", owner, () => true, release, { x: .4, z: 0 });
    updateReservationWatchdogs(context, 4);
    updateReservationWatchdogs(context, 4);
    expect(release).toHaveBeenCalledOnce();
  });

  it("finds a person touching the owner on its way to a far waypoint, not one behind it", () => {
    const { blocker, context, owner, release } = fixture();
    owner.path = [{ x: 3, z: 0 }];
    updateReservationWatchdogs(context, 4);
    expect(blocker.queueTarget).toEqual({ x: 2, z: 2 });
    updateReservationWatchdogs(context, 4);
    expect(release).toHaveBeenCalledOnce();
    const behind = fixture();
    behind.owner.path = [{ x: -3, z: 0 }];
    updateReservationWatchdogs(behind.context, 8);
    expect(behind.blocker.queueTarget).toBeUndefined();
    expect(behind.release).not.toHaveBeenCalled();
  });

  it("resets on progress and never shoves a working builder", () => {
    const { blocker, context, owner, release } = fixture("Builder");
    updateReservationWatchdogs(context, 4);
    expect(blocker.queueTarget).toBeUndefined();
    owner.x = .13;
    updateReservationWatchdogs(context, 4);
    expect(release).not.toHaveBeenCalled();
    updateReservationWatchdogs(context, 7.9);
    expect(release).not.toHaveBeenCalled();
    updateReservationWatchdogs(context, .1);
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not release a physical handoff or a reservation that has changed owner", () => {
    const { context, invalidate, owner, release } = fixture();
    owner.wareTransfer = {} as NonNullable<SettlementActor["wareTransfer"]>;
    updateReservationWatchdogs(context, 20);
    expect(release).not.toHaveBeenCalled();
    owner.wareTransfer = undefined;
    invalidate();
    updateReservationWatchdogs(context, 20);
    expect(release).not.toHaveBeenCalled();
  });
});
