import { describe, expect, it } from "vitest";

import {
  FAR_PROPS_CADENCE, farPropHoldable, farPropPlacementDue, farPropsEnabled, readFarPropsMode, setFarPropsMode
} from "../src/renderers/three/worker-far-props-mode";

describe("far props mode", () => {
  it("enables the far path by default and only ?farprops=exact rolls it back", () => {
    expect(readFarPropsMode(null)).toBe("far");
    expect(readFarPropsMode("exact")).toBe("exact");
    expect(readFarPropsMode("far")).toBe("far");
    setFarPropsMode("exact");
    expect(farPropsEnabled()).toBe(false);
    setFarPropsMode("far");
    expect(farPropsEnabled()).toBe(true);
  });

  it("places far props once per cadence and holds them on the other poses", () => {
    expect(FAR_PROPS_CADENCE).toBe(2);
    expect([0, 1, 2, 3, 4, 5].map(farPropPlacementDue)).toEqual([true, false, true, false, true, false]);
    // Any starting tick is a valid phase; the cadence only has to alternate.
    let placements = 0;
    for (let tick = 0; tick < 100; tick++) placements += farPropPlacementDue(tick) ? 1 : 0;
    expect(placements).toBe(100 / FAR_PROPS_CADENCE);
  });

  it("holds only poses whose props do not follow a swinging arm", () => {
    expect(farPropHoldable({ action: "carry_shoulder" })).toBe(true);
    expect(farPropHoldable({ action: "carry_back" })).toBe(true);
    expect(farPropHoldable({ action: "idle_breathe" })).toBe(true);
    expect(farPropHoldable({ action: "walk" })).toBe(false);
    expect(farPropHoldable({ action: "run" })).toBe(false);
    expect(farPropHoldable({ action: "chop_tree" })).toBe(false);
    expect(farPropHoldable({ action: "carry_back", wareTransfer: {} as never })).toBe(false);
  });
});
