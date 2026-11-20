import { describe, expect, it } from "vitest";

import { WORKER_RADIUS } from "../src/render-common/workers/worker-dimensions";
import {
  CHARCOAL_LOG_LAYOUT,
  CHARCOAL_LOG_RADIUS,
  CHARCOAL_MOUND_BOTTOM_Y,
  CHARCOAL_MOUND_RADIUS,
  CHARCOAL_MOUND_TOP_Y,
  CHARCOAL_SMOKE_START_Y,
  CHARCOAL_WORK_STAND_OFF,
  charcoalMoundTopY,
  charcoalStageVisual
} from "../src/shared/settlement/charcoal-field";
import {
  fieldWorkPoint,
  fieldWorkStandOff
} from "../src/shared/settlement/settlement-field-cycles";

const CURRENT = { x: 10, z: 10 };
/** Approach bearings in all four quadrants; field contacts must not depend on camera/world yaw. */
const BEARINGS = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]
] as const;

describe("charcoal clamp work contact", () => {
  it("stands outside the full clamp footprint on every approach bearing", () => {
    expect(fieldWorkStandOff("charcoal")).toBe(CHARCOAL_WORK_STAND_OFF);
    expect(CHARCOAL_WORK_STAND_OFF).toBeGreaterThan(CHARCOAL_MOUND_RADIUS + WORKER_RADIUS);
    for (const [dx, dz] of BEARINGS) {
      const origin = { x: CURRENT.x - dx * 3, z: CURRENT.z - dz * 3 };
      const contact = fieldWorkPoint("charcoal", CURRENT, origin);
      const distance = Math.hypot(contact.x - CURRENT.x, contact.z - CURRENT.z);
      expect(distance).toBeCloseTo(CHARCOAL_WORK_STAND_OFF, 10);
      expect(distance).toBeGreaterThan(CHARCOAL_MOUND_RADIUS + WORKER_RADIUS);
    }
  });
  it("keeps non-charcoal work contacts unchanged", () => {
    expect(fieldWorkStandOff("grain")).toBeCloseTo(0.42);
    expect(fieldWorkPoint("grain", CURRENT, { x: 7, z: CURRENT.z }))
      .toEqual({ x: CURRENT.x - 0.42, z: CURRENT.z });
  });
});

describe("charcoal progress staging", () => {
  it("shows exactly the six paid logs and no seventh filler log", () => {
    expect(CHARCOAL_LOG_LAYOUT).toHaveLength(6);
    // Even visits unload a log; the following covering visit must not add another.
    const visibleCrowns = Array.from({ length: 12 }, (_, step) =>
      charcoalStageVisual("building", step).logs.filter(Boolean).length);
    expect(visibleCrowns[0]).toBe(1);
    expect(visibleCrowns[1]).toBe(1);
    expect(visibleCrowns[10]).toBeGreaterThan(0);
    expect(charcoalStageVisual("building", 11).logs.some(Boolean)).toBe(false);
  });
  it("grows the earth clamp with covering visits and never shows a fully buried log", () => {
    let previousTop = -Infinity;
    for (let step = 0; step < 12; step++) {
      const visual = charcoalStageVisual("building", step);
      const top = charcoalMoundTopY(visual.moundScaleY);
      expect(top).toBeGreaterThanOrEqual(previousTop);
      previousTop = top;
      visual.logs.forEach((visible, index) => {
        if (!visible) return;
        const log = CHARCOAL_LOG_LAYOUT[index]!;
        expect(log.y + CHARCOAL_LOG_RADIUS).toBeGreaterThan(top);
      });
    }
    const final = charcoalStageVisual("building", 11);
    expect(charcoalMoundTopY(final.moundScaleY)).toBeCloseTo(CHARCOAL_MOUND_TOP_Y);
    expect(charcoalStageVisual("building", 10).moundScaleY)
      .toBeLessThan(final.moundScaleY);
  });
  it("keeps the clamp bottom grounded while the coal heap is collected", () => {
    const tops: number[] = [];
    for (let step = 0; step < 6; step++) {
      const visual = charcoalStageVisual("coal", step);
      expect(visual.coalMaterial).toBe(true);
      expect(visual.moundVisible).toBe(true);
      expect(visual.moundCenterY - CHARCOAL_MOUND_RADIUS * visual.moundScaleY)
        .toBeCloseTo(CHARCOAL_MOUND_BOTTOM_Y);
      tops.push(charcoalMoundTopY(visual.moundScaleY));
    }
    expect(tops.every((top, index) => index === 0 || top <= tops[index - 1]!)).toBe(true);
    expect(tops.at(-1)).toBeGreaterThan(0);
  });
  it("anchors smoke above the completed clamp", () => {
    const smallestPuffRadius = 0.06;
    expect(CHARCOAL_SMOKE_START_Y - smallestPuffRadius).toBeGreaterThanOrEqual(CHARCOAL_MOUND_TOP_Y);
    const burning = charcoalStageVisual("burning", 0);
    expect(burning.smokeVisible).toBe(true);
    expect(burning.moundVisible).toBe(true);
    expect(burning.logs.some(Boolean)).toBe(false);
  });
  it("replaces logs with the completed clamp for burning and uncovering", () => {
    for (const state of ["burning", "uncovering", "coal"] as const) {
      const visual = charcoalStageVisual(state, 0);
      expect(visual.logsVisible).toBe(false);
      expect(visual.moundScaleY).toBeGreaterThan(0);
    }
    expect(charcoalStageVisual("uncovering", 5).coalMaterial).toBe(false);
  });
});
