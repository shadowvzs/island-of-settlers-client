import { describe, expect, it } from "vitest";

import { SHIP_ACCELERATION, SHIP_DECELERATION } from "../../src/shared/settlement/settlement-ship-kinematics";
import { SHIP_TICK, type ShipScenario, stressLayoutScenario } from "./ship-motion-scenarios";

const STRESS_SHIPS = 6;

/**
 * The largest per-tick speed change beyond the acceleration (gathering way) or braking (losing it)
 * limit, over every ship present in two consecutive ticks; 0 when every change is within its limit.
 */
export const worstExcess = ({ done, fleet, seconds }: ShipScenario) => {
  const last = new Map<number, number>();
  let worst = 0;
  for (let tick = 0; tick < seconds / SHIP_TICK && !done(); tick++) {
    fleet.update(SHIP_TICK);
    const seen = new Map<number, number>();
    for (const frame of fleet.frames()) {
      const speed = (frame as { speed?: number }).speed ?? 0, before = last.get(frame.id);
      seen.set(frame.id, speed);
      if (before === undefined) continue;
      const gathering = Math.abs(speed) > Math.abs(before) && speed * before >= 0;
      const limit = (gathering ? SHIP_ACCELERATION : SHIP_DECELERATION) * SHIP_TICK;
      worst = Math.max(worst, Math.abs(speed - before) - limit);
    }
    // Ships beyond the map edge (away) start a new track when they sail back in.
    last.clear();
    seen.forEach((speed, id) => last.set(id, speed));
  }
  return worst;
};

/**
 * Owner 2026-10-15: no ship jumps from standing still to full speed (or stops dead) in one tick.
 * Stress layouts `from`..`to - 1` of six ships each; the 16 layouts are spread over three files
 * (ship-speed-limit*.test.ts) so the slow project runs them in parallel (TEST-01).
 */
export const describeStressLayouts = (from: number, to: number) =>
  describe("ship speed changes stay within the acceleration limit", () => {
    it.each(Array.from({ length: to - from }, (_, index) => from + index))("stress layout %i", index => {
      expect(worstExcess(stressLayoutScenario(index, STRESS_SHIPS))).toBeLessThanOrEqual(1e-9);
    }, 120000);
  });
