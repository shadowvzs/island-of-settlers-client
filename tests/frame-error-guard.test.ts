import { describe, expect, it } from "vitest";

import { createFrameErrorGuard } from "../src/app/frame-error-guard";

describe("render frame error guard", () => {
  it("returns the fallback for a throwing frame and keeps running later frames", () => {
    const logged: string[] = [];
    const guard = createFrameErrorGuard(message => logged.push(message));
    const draw = (frame: number) => {
      if (frame === 2) throw new Error("bad frame");
      return true;
    };
    const results = [1, 2, 3].map(frame => guard.run(draw, frame, false));
    expect(results).toEqual([true, false, true]);
    expect(guard.failures()).toBe(1);
    expect(logged).toHaveLength(1);
  });

  it("logs a repeating error once, then only every 600th repeat", () => {
    const logged: string[] = [];
    const guard = createFrameErrorGuard(message => logged.push(message));
    const fail = () => { throw new TypeError("same"); };
    for (let frame = 0; frame < 1200; frame++) guard.run(fail, frame, undefined);
    expect(guard.failures()).toBe(1200);
    expect(logged).toEqual([
      "Render frame failed (1x); later frames continue",
      "Render frame failed (600x); later frames continue",
      "Render frame failed (1200x); later frames continue"
    ]);
  });
});
