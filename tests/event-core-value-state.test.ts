import { describe, expect, it } from "vitest";

import {
  canonicalValueState, diffValueState, PRESENTATION_ONLY_FIELDS, sameValueState, valueStateKey
} from "../src/shared/settlement/event-core/value-state";

describe("event-core value state", () => {
  it("sorts object keys, keeps array order and excludes only opted-in presentation fields", () => {
    const left = { actors: [{ status: "work", yaw: 1 }, { status: "idle" }], building: { level: 2 } };
    const right = { building: { level: 2 }, actors: [{ yaw: 9, status: "work" }, { status: "idle" }] };
    expect(sameValueState(left, right)).toBe(false);
    expect(sameValueState(left, right, { exclude: PRESENTATION_ONLY_FIELDS })).toBe(true);
    expect(valueStateKey(left, { exclude: PRESENTATION_ONLY_FIELDS }))
      .toBe(valueStateKey(right, { exclude: PRESENTATION_ONLY_FIELDS }));
    expect(sameValueState(left, { ...right, building: { level: 3 } },
      { exclude: PRESENTATION_ONLY_FIELDS })).toBe(false);
    expect(canonicalValueState(left, { exclude: PRESENTATION_ONLY_FIELDS }))
      .toEqual({ actors: [{ status: "work" }, { status: "idle" }], building: { level: 2 } });
  });

  it("keeps status, animation time and door by default and reports the first differing path", () => {
    expect(sameValueState({ status: "work" }, { status: "idle" })).toBe(false);
    expect(sameValueState({ animationTime: 1 }, { animationTime: 2 })).toBe(false);
    expect(sameValueState({ door: 0.2 }, { door: 0.8 })).toBe(false);
    expect(diffValueState({ actors: [{ status: "work", yaw: 1 }] }, { actors: [{ status: "work", yaw: 2 }] }))
      .toEqual({ left: 1, path: "$.actors[0].yaw", right: 2 });
    expect(diffValueState({ actors: [{ status: "work", yaw: 1 }] }, { actors: [{ status: "work", yaw: 2 }] },
      { exclude: PRESENTATION_ONLY_FIELDS })).toBeNull();
    expect(diffValueState({ actors: [{ status: "work" }] }, { actors: [{ status: "idle" }] }))
      .toEqual({ left: "work", path: "$.actors[0].status", right: "idle" });
  });
});
