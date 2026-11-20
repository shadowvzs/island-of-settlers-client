import { describe, expect, it } from "vitest";

import {
  calibratedEconomyCycle, extendedCalibratedEconomyCycle
} from "../src/app/settlement/offline-economy-calibration";

const ticks = (seconds: number[]) => seconds.map(value => Math.round(value / .05));
describe("offline cycle calibration", () => {
  it("removes measured stock waits while retaining native work and travel between completions", () => {
    const samples = ticks([10, 50, 100]);
    expect(calibratedEconomyCycle(samples, 2200, 5)).toBe(45);
    expect(calibratedEconomyCycle(samples, 2200, 5,
      { atOutputs: [0, 20, 50], atEnd: 50 })).toBe(20);
  });
  it("does not subtract a later stock wait from an earlier completed interval", () => {
    expect(calibratedEconomyCycle(ticks([10, 30, 50]), 2000, 5,
      { atOutputs: [0, 0, 0], atEnd: 50 })).toBe(20);
  });
  it("rejects stock-wait observations with different counts or impossible ownership of time", () => {
    expect(calibratedEconomyCycle(ticks([10, 30]), 1000, 5,
      { atOutputs: [0], atEnd: 0 })).toBeUndefined();
    expect(calibratedEconomyCycle(ticks([10, 30]), 1000, 5,
      { atOutputs: [0, 21], atEnd: 21 })).toBeUndefined();
  });
  it("uses the initial window's own stock waits when a longer calibration is requested", () => {
    expect(extendedCalibratedEconomyCycle(ticks([10, 50, 90, 220]), 0, 6000, 5,
      { atOutputs: [0, 10, 20, 90], atEnd: 100, atInitialEnd: 30 })).toBe(30);
  });
  it("retains traffic delays in a sustained well cycle instead of choosing the fastest trip", () => {
    const samples = ticks([7.35, 43.55, 55.30, 83.65, 95.40, 107.15]);
    expect(calibratedEconomyCycle(samples, 2400, 7)).toBeCloseTo(19.96);
    expect(calibratedEconomyCycle(samples, 2400, 7)).toBeGreaterThan(11.75);
  });
  it("does not repeat production that stopped well before the sample ended", () => {
    expect(calibratedEconomyCycle(ticks([1, 6, 11, 16]), 2400, 3)).toBeUndefined();
  });
  it("retains the sparse-series guard and never infers a rate from one output", () => {
    expect(calibratedEconomyCycle(ticks([1, 6, 26]), 600, 3)).toBeUndefined();
    expect(calibratedEconomyCycle(ticks([1]), 2400, 3)).toBeUndefined();
  });
  it("uses extra native time to learn a slow cycle absent from the initial window", () => {
    expect(extendedCalibratedEconomyCycle(ticks([90, 180, 270]), 0, 6000, 12)).toBe(90);
  });
  it("keeps an established initial cycle when later intervals include a temporary backlog", () => {
    const samples = ticks([10, 40, 70, 100, 220, 280]);
    expect(extendedCalibratedEconomyCycle(samples, 0, 6000, 12)).toBe(30);
  });
  it("places the initial sampling window relative to the saved island tick", () => {
    const start = 2_000_000;
    expect(extendedCalibratedEconomyCycle(ticks([10, 40, 70, 100, 220, 280]).map(tick => tick + start),
      start, start + 6000, 12)).toBe(30);
  });
});
