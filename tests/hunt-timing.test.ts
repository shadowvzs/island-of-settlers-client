import { describe, expect, it } from "vitest";

import {
completeHuntFlight,   HUNT_ARROW_RELEASE_SECONDS, HUNT_DRAW_SECONDS, huntArrowCanRelease
} from "../src/shared/settlement/settlement-hunting";

describe("hunt draw timing", () => {
  it("holds the arrow until the release boundary and then allows the shot", () => {
    expect(HUNT_ARROW_RELEASE_SECONDS).toBeCloseTo(HUNT_DRAW_SECONDS * .25, 12);
    expect(huntArrowCanRelease(HUNT_ARROW_RELEASE_SECONDS + .01)).toBe(false);
    expect(huntArrowCanRelease(HUNT_ARROW_RELEASE_SECONDS)).toBe(true);
    expect(huntArrowCanRelease(0)).toBe(true);
  });

  it("resolves a scheduled flight against the live target", () => {
    let hits = 0, finished = 0;
    const actor = { phase: "huntFlight", target: { id: 7 }, huntArrow: {} } as unknown as import("../src/shared/settlement/settlement-types").SettlementActor;
    const context = { options: {
      getHuntTarget: () => ({ dead: false, x: 1, z: 1 }),
      hitHuntTarget: () => { hits++; }
    } } as never;
    expect(completeHuntFlight(context, actor, () => { finished++; })).toBe(true);
    expect(hits).toBe(1);
    expect(finished).toBe(0);
    expect(actor.phase).toBe("huntWait");
    expect(actor.huntArrow).toBeUndefined();
  });

  it("returns control to the worker when the prey disappeared before landing", () => {
    let finished = 0;
    const actor = { phase: "huntFlight", target: { id: 7 }, huntArrow: {} } as unknown as import("../src/shared/settlement/settlement-types").SettlementActor;
    const context = { options: { getHuntTarget: () => undefined } } as never;
    expect(completeHuntFlight(context, actor, () => { finished++; })).toBe(false);
    expect(finished).toBe(1);
  });
});
