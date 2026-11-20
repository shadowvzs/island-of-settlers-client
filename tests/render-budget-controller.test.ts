import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BUDGET_LOWER_FPS,
  BUDGET_TARGET_FPS,
  createRenderBudgetController,
  MIN_STEP_INTERVAL_MS,
  type RenderBudgetLevers,
  type RenderBudgetLimits
} from "../src/render-common/render-budget-controller";

const LIMITS: RenderBudgetLimits = {
  lowerFps: BUDGET_LOWER_FPS, maxCpuLevel: 3, minScale: 0.6, targetFps: BUDGET_TARGET_FPS
};
const VSYNC_MS = 1000 / 60;

/** Deterministic noise in [-1, 1]. */
const createNoise = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff * 2 - 1;
  };
};

interface Workload {
  /** Main-thread ms per frame at CPU level 0; each level saves `cpuSaving`. */
  cpu: number;
  cpuSaving?: number;
  /** GPU ms at render scale 1; it scales with the pixel count. */
  gpu: number;
  /** Relative jitter of both. */
  noise?: number;
  /** False: no timer queries (the controller must classify without GPU time). */
  gpuTimer?: boolean;
}

interface Change {
  levers: RenderBudgetLevers;
  time: number;
}

/** Drives the controller with frames whose cost follows the levers it chose (vsync quantised). */
const run = (workload: Workload | ((time: number) => Workload), seconds: number, limits = LIMITS) => {
  const controller = createRenderBudgetController(limits);
  const noise = createNoise(7);
  const changes: Change[] = [];
  const intervals: number[] = [];
  let levers: RenderBudgetLevers = { cpuLevel: 0, renderScale: 1 };
  let time = 0;
  while (time < seconds * 1000) {
    const current = typeof workload === "function" ? workload(time) : workload;
    const jitter = 1 + (current.noise ?? 0) * noise();
    const cpu = Math.max(0.5, (current.cpu - levers.cpuLevel * (current.cpuSaving ?? 0)) * jitter);
    const gpu = current.gpu * levers.renderScale * levers.renderScale * jitter;
    const interval = Math.ceil(Math.max(cpu, gpu, 1) / VSYNC_MS) * VSYNC_MS;
    time += interval;
    intervals.push(interval);
    if (current.gpuTimer !== false) controller.recordGpu(time, gpu);
    const next = controller.recordFrame(time, interval, cpu);
    if (next) {
      levers = next;
      changes.push({ levers: next, time });
    }
  }
  return { changes, controller, intervals, levers };
};

const p90 = (values: readonly number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length * 0.9)]!;
};

const expectSpacedChanges = (changes: readonly Change[]) => {
  for (let index = 1; index < changes.length; index++)
    expect(changes[index]!.time - changes[index - 1]!.time).toBeGreaterThanOrEqual(MIN_STEP_INTERVAL_MS);
};

describe("render budget controller (R09 + C13)", () => {
  it("lowers the render scale on a GPU-bound load until 40 fps holds, never the CPU levers", () => {
    const { changes, intervals, levers } = run({ cpu: 6, gpu: 40, noise: 0.1 }, 60);
    expect(levers.renderScale).toBeLessThan(1);
    expect(levers.renderScale).toBeGreaterThanOrEqual(LIMITS.minScale);
    expect(levers.cpuLevel).toBe(0);
    expect(changes.every(change => change.levers.cpuLevel === 0)).toBe(true);
    expect(p90(intervals.slice(-600))).toBeLessThanOrEqual(1000 / BUDGET_LOWER_FPS);
    expectSpacedChanges(changes);
  });

  it("does not downscale a CPU-bound load: it raises the CPU level instead", () => {
    const { changes, levers } = run({ cpu: 32, cpuSaving: 4, gpu: 6, noise: 0.1 }, 60);
    expect(levers.renderScale).toBe(1);
    expect(levers.cpuLevel).toBeGreaterThan(0);
    expect(changes.every(change => change.levers.renderScale === 1)).toBe(true);
    expectSpacedChanges(changes);
  });

  it("reports exhaustion instead of downscaling when the CPU levers cannot help", () => {
    const { controller, levers } = run({ cpu: 45, gpu: 5 }, 30);
    expect(levers).toEqual({ cpuLevel: 3, renderScale: 1 });
    expect(controller.status().exhausted).toBe(true);
  });

  it("does not oscillate on a noisy load near the lower bound", () => {
    const { changes } = run({ cpu: 5, gpu: 26, noise: 0.35 }, 300);
    expect(changes.length).toBeLessThanOrEqual(6);
    const lastMinute = changes.filter(change => change.time > 240000);
    expect(lastMinute.length).toBeLessThanOrEqual(1);
    expectSpacedChanges(changes);
  });

  it("does not raise the scale into an overrun when the next step's predicted GPU time does not fit", () => {
    // 0.6 fits the display rate (11.5 ms), 0.65 is predicted at 13.5 ms (fits), 0.7 at 15.7 ms, 0.75 at 18 ms.
    const { changes } = run({ cpu: 4, gpu: 32 }, 240);
    const after = changes.filter(change => change.time > 60000);
    expect(after.every(change => change.levers.renderScale <= 0.7 + 1e-9)).toBe(true);
    expect(after.length).toBeLessThanOrEqual(2);
  });

  it("returns to full resolution once the load is gone", () => {
    const heavy = (time: number): Workload => time < 30000 ? { cpu: 5, gpu: 40 } : { cpu: 5, gpu: 6 };
    const { changes, levers } = run(heavy, 90);
    expect(changes.some(change => change.levers.renderScale < 1)).toBe(true);
    expect(levers).toEqual({ cpuLevel: 0, renderScale: 1 });
    expectSpacedChanges(changes);
  });

  it("without a GPU timer keeps a resolution trial that helps", () => {
    const { levers } = run({ cpu: 6, gpu: 40, gpuTimer: false }, 60);
    expect(levers.renderScale).toBeLessThan(1);
    expect(levers.cpuLevel).toBe(0);
  });

  it("without a GPU timer undoes a resolution trial that does not help and uses the CPU levers", () => {
    // Main-thread time below 80 % of the interval: the cause is unclear, but only the CPU matters.
    const { changes, levers } = run({ cpu: 24, cpuSaving: 5, gpu: 2, gpuTimer: false }, 60);
    expect(changes.some(change => change.levers.renderScale < 1)).toBe(true);
    expect(levers.renderScale).toBe(1);
    expect(levers.cpuLevel).toBeGreaterThan(0);
  });

  it("stays within the allowed limits", () => {
    const { levers } = run({ cpu: 6, gpu: 80 }, 60, { ...LIMITS, minScale: 0.8 });
    expect(levers.renderScale).toBeCloseTo(0.8, 5);
    const locked = run({ cpu: 6, gpu: 80 }, 30, { ...LIMITS, minScale: 1 });
    expect(locked.changes).toEqual([]);
    expect(locked.controller.status().exhausted).toBe(true);
  });

  it("clamps the levers to new limits and resets to full presentation", () => {
    const { controller, levers } = run({ cpu: 6, gpu: 60 }, 40);
    expect(levers.renderScale).toBeLessThan(0.9);
    expect(controller.setLimits(50000, { ...LIMITS, minScale: 0.9 })).toEqual({ cpuLevel: 0, renderScale: 0.9 });
    expect(controller.reset(50001)).toEqual({ cpuLevel: 0, renderScale: 1 });
    expect(controller.status().cause).toBeNull();
  });

  it("ignores frames while frozen", () => {
    const controller = createRenderBudgetController(LIMITS);
    controller.freeze(0, 10000);
    for (let time = 0; time < 9000; time += 50)
      expect(controller.recordFrame(time, 50, 45)).toBeNull();
  });

  it("is a pure presentation module: no simulation, world or renderer import", () => {
    const source = readFileSync(new URL("../src/render-common/render-budget-controller.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/^import /m);
  });
});
