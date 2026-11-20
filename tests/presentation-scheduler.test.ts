import { describe, expect, it } from "vitest";

import { createPresentationScheduler, type PresentationJob } from "../src/render-common/presentation-scheduler";

const job = (step: PresentationJob["step"]): PresentationJob => ({ step });

describe("presentation leftover-time scheduler (R23)", () => {
  it("runs higher priority first and keeps FIFO within a priority", () => {
    const scheduler = createPresentationScheduler();
    const order: string[] = [];
    scheduler.enqueue(job(() => { order.push("low"); return true; }), 1);
    scheduler.enqueue(job(() => { order.push("high-a"); return true; }), 5);
    scheduler.enqueue(job(() => { order.push("high-b"); return true; }), 5);
    expect(scheduler.runBudget(5)).toBe(3);
    expect(order).toEqual(["high-a", "high-b", "low"]);
  });

  it("stops at the deadline and leaves unfinished jobs for the next frame", () => {
    let clock = 0;
    const scheduler = createPresentationScheduler(() => clock);
    const slices: number[] = [];
    scheduler.enqueue(job((budget) => {
      slices.push(budget);
      clock += 2;
      return slices.length === 2;
    }));
    expect(scheduler.runBudget(5)).toBe(1);
    expect(slices).toEqual([5]);
    expect(scheduler.size()).toBe(1);
    expect(scheduler.runBudget(5)).toBe(1);
    expect(slices).toEqual([5, 5]);
    expect(scheduler.size()).toBe(0);
  });

  it("does no work when there is no leftover time", () => {
    let runs = 0;
    const scheduler = createPresentationScheduler();
    scheduler.enqueue(job(() => { runs += 1; return true; }));
    expect(scheduler.runBudget(0)).toBe(0);
    expect(scheduler.runBudget(-2)).toBe(0);
    expect(runs).toBe(0);
    expect(scheduler.size()).toBe(1);
  });

  it("cancels a queued job without running it", () => {
    const scheduler = createPresentationScheduler();
    let runs = 0;
    const queued = scheduler.enqueue(job(() => { runs += 1; return true; }));
    queued.cancel();
    expect(scheduler.size()).toBe(0);
    expect(scheduler.runBudget(5)).toBe(0);
    expect(runs).toBe(0);
  });

  it("resumes a job that asks for several slices", () => {
    let remaining = 3;
    const scheduler = createPresentationScheduler();
    scheduler.enqueue(job(() => {
      remaining -= 1;
      return remaining === 0;
    }));
    expect(scheduler.runBudget(10)).toBe(1);
    expect(remaining).toBe(2);
    expect(scheduler.runBudget(10)).toBe(1);
    expect(remaining).toBe(1);
    expect(scheduler.runBudget(10)).toBe(1);
    expect(scheduler.size()).toBe(0);
  });
});
