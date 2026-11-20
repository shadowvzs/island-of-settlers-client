import { describe, expect, it } from "vitest";

import {
  createFrameRateCap,
  frameDivisor,
  limitFps,
  snapDisplayRate
} from "../src/render-common/frame-rate-cap";

/** Calls `due` for `frames` display frames of `hz`; returns the drawn count. */
const countDrawn = (hz: number, limit: Parameters<typeof createFrameRateCap>[0], frames: number) => {
  const cap = createFrameRateCap(limit);
  let drawn = 0;
  for (let frame = 0; frame < frames; frame++) if (cap.due(frame * 1000 / hz)) drawn++;
  return { cap, drawn };
};

describe("frame-rate cap (C13)", () => {
  it("snaps measured intervals to common display rates", () => {
    expect(snapDisplayRate(16.9)).toBe(60);
    expect(snapDisplayRate(8.4)).toBe(120);
    expect(snapDisplayRate(6.9)).toBe(144);
    expect(snapDisplayRate(0)).toBe(60);
  });

  it("limits only to even divisors of the display rate", () => {
    expect(frameDivisor("display", 120)).toBe(1);
    expect(frameDivisor("limit60", 60)).toBe(1);
    expect(frameDivisor("limit60", 120)).toBe(2);
    expect(frameDivisor("saver", 60)).toBe(2);
    expect(limitFps("saver", 120)).toBe(40);
    expect(frameDivisor("saver", 120)).toBe(3);
  });

  it("draws every frame without a limit and every second one at 60 fps on a 120 Hz display", () => {
    expect(countDrawn(60, "display", 600).drawn).toBe(600);
    const { cap, drawn } = countDrawn(120, "limit60", 1200);
    expect(cap.displayHz()).toBe(120);
    // The first measurement window (120 frames) still assumes 60 Hz and draws every frame.
    expect(drawn).toBeGreaterThan(590);
    expect(drawn).toBeLessThan(680);
  });
});
