import { Vector3 } from "three";
import { describe, expect, it } from "vitest";

import {
  fortCollapseScale, fortFlameFade, fortRuinOpacity, fortSiegeFrame, isFortSmouldering, isFortStanding
} from "../src/render-common/buildings/fort-siege-visual";
import { spreadFireSpots } from "../src/renderers/three/buildings/building-siege-fire";

describe("colony fort siege visuals", () => {
  it("shows health and one flame per 20 % lost, then the time since the fall", () => {
    expect(fortSiegeFrame(undefined)).toBeUndefined();
    expect(fortSiegeFrame({ hp: 35_000, maximum: 50_000 })).toEqual({ flames: 1, health: .7 });
    expect(fortSiegeFrame({ fallen: 2, hp: 0, maximum: 50_000 })).toEqual({ fallenAge: 2, flames: 5, health: 0 });
  });

  it("burns 5 s, collapses, then leaves a smouldering ruin that fades before the plot is cleared", () => {
    expect([undefined, 0, 4.9].map(age => fortCollapseScale(age))).toEqual([1, 1, 1]);
    expect(fortCollapseScale(5.75)).toBeCloseTo(.5);
    expect(fortCollapseScale(7)).toBeCloseTo(.03);
    expect(isFortStanding(6)).toBe(true);
    expect(isFortStanding(6.6)).toBe(false);
    expect(fortFlameFade(3)).toBe(1);
    expect(fortFlameFade(8)).toBe(0);
    expect(fortRuinOpacity(3)).toBe(0);
    expect(fortRuinOpacity(7)).toBe(1);
    expect(fortRuinOpacity(10)).toBe(0);
    expect(isFortSmouldering(6)).toBe(false);
    expect(isFortSmouldering(8)).toBe(true);
  });

  it("starts an open scaffold's collapse immediately while its archers fall", () => {
    const frame = fortSiegeFrame({ fallen: .4, hp: 0, maximum: 35_000 }, true)!;
    expect(fortCollapseScale(frame.fallenAge)).toBeLessThan(1);
    expect(fortCollapseScale(frame.fallenAge)).toBeGreaterThan(0);
    expect(fortSiegeFrame({ hp: 35_000, maximum: 35_000 }, true)?.fallenAge).toBeUndefined();
  });

  it("spreads the five fires over different spots, the highest first", () => {
    const candidates = [new Vector3(0, 3, 0), new Vector3(.1, 2, 0), new Vector3(2, 2, 2), new Vector3(-2, 2, 2),
      new Vector3(2, 1.5, -2), new Vector3(-2, 1.5, -2), new Vector3(.2, 2.9, .1)];
    const spots = spreadFireSpots(candidates, 5);
    expect(spots[0]!.y).toBe(3);
    expect(new Set(spots).size).toBe(5);
    expect(spots).not.toContain(candidates[6]);
    expect(spreadFireSpots([], 5)).toEqual([]);
  });
});
