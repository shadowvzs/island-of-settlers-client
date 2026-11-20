import { expect, it } from "vitest";

import { blockedWalkAction, nextBlockedSeconds } from "../src/app/settlement/settlement-blocked-pose";

it("a blocked walker breathes in place after a moment and strides again on its first moved frame", () => {
  let blocked = 0;
  const frame = (outcome: Parameters<typeof nextBlockedSeconds>[1], moved: number) => {
    blocked = nextBlockedSeconds(blocked, outcome, moved, .04);
    return blockedWalkAction("walk", blocked);
  };
  expect(frame("person-blocked", 0)).toBe("walk");
  expect(frame("person-blocked", 0)).toBe("walk");
  expect(frame("person-blocked", 0)).toBe("walk");
  expect(frame("person-blocked", 0)).toBe("idle_breathe");
  expect(frame("moving", .04)).toBe("walk");
  expect(blocked).toBe(0);
});

it("only queue and block outcomes stop the stride; other actions are untouched", () => {
  expect(nextBlockedSeconds(1, "moving", 0, .05)).toBe(0);
  expect(nextBlockedSeconds(1, "arrived", 0, .05)).toBe(0);
  expect(nextBlockedSeconds(0, "door-queue", 0, .2)).toBeCloseTo(.2);
  expect(blockedWalkAction("chop", 5)).toBe("chop");
});
