import { describe, expect, it } from "vitest";

import { advanceFishingPhase, FISHING_WORK_TIMING } from "../src/shared/settlement/outdoor-work-timing";

describe("fishing work timing", () => {
  it("keeps a phase in progress without losing the timer residue", () => {
    const next = advanceFishingPhase("fishCast", FISHING_WORK_TIMING.cast, 2);
    expect(next.phase).toBe("fishCast");
    expect(next.action).toBe("fish_cast");
    expect(next.done).toBe(false);
    expect(next.timer).toBeCloseTo(.4, 12);
  });

  it("moves cast to wait and wait to reel on the exact boundary", () => {
    expect(advanceFishingPhase("fishCast", .2, .2))
      .toEqual({ phase: "fishWait", action: "fish_wait", timer: FISHING_WORK_TIMING.wait, done: false });
    expect(advanceFishingPhase("fishWait", .2, .2))
      .toEqual({ phase: "fishReel", action: "fish_reel", timer: FISHING_WORK_TIMING.reel, done: false });
    expect(advanceFishingPhase("fishReel", .2, .2))
      .toEqual({ phase: "fishReel", action: "fish_reel", timer: 0, done: true });
  });

  it("preserves the visible action for the whole phase", () => {
    expect(advanceFishingPhase("fishWait", 1, .1).action).toBe("fish_wait");
    expect(advanceFishingPhase("fishReel", 1, .1).action).toBe("fish_reel");
  });
});
