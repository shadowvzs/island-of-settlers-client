import { describe, expect, it, vi } from "vitest";

import { DEFAULT_ADAPTIVE_PERFORMANCE } from "../src/app/render-budget/constants";
import { createRenderBudget } from "../src/app/render-budget/render-budget";
import { createResolutionState } from "../src/render-common/resolution";

const createBudget = (getView = vi.fn(() => "iso" as const)) => {
  const resolution = createResolutionState({ antialias: true, maxPixelRatio: Infinity });
  const renderer = { setAnimationCadenceBias: vi.fn() };
  const decoration = { isEnabled: () => true, setSuppressed: vi.fn() };
  const saveSettings = vi.fn();
  const budget = createRenderBudget({
    decoration, quality: { renderScaleMin: 0.75 }, renderer, resolution,
    settings: DEFAULT_ADAPTIVE_PERFORMANCE, getView, saveSettings
  });
  return { budget, decoration, getView, renderer, resolution, saveSettings };
};

/** GPU-bound 20 fps frames for `seconds`, starting at `start` ms. */
const feedGpuBound = (budget: ReturnType<typeof createBudget>["budget"], start: number, seconds: number) => {
  let time = start;
  while (time < start + seconds * 1000) {
    time += 50;
    budget.loop.recordGpu(time, 45);
    budget.loop.recordFrame(time, 50, 5);
  }
  return time;
};

describe("render budget adapter", () => {
  it("reads the view only per frame (the runtime wires its sources later)", () => {
    const { getView } = createBudget();
    expect(getView).not.toHaveBeenCalled();
  });

  it("lowers the live render scale on GPU-bound frames and bumps the resize revision", () => {
    const { budget, renderer, resolution } = createBudget();
    feedGpuBound(budget, 0, 20);
    expect(resolution.renderScale).toBeLessThan(1);
    expect(resolution.renderScale).toBeGreaterThanOrEqual(0.75);
    expect(resolution.revision).toBeGreaterThan(0);
    expect(renderer.setAnimationCadenceBias).toHaveBeenLastCalledWith(0);
    expect(budget.controls.snapshot.getSnapshot().renderScale).toBe(resolution.renderScale);
  });

  it("switching Auto off restores full resolution and stores the choice", () => {
    const { budget, resolution, saveSettings } = createBudget();
    feedGpuBound(budget, 0, 20);
    budget.controls.setSettings({ ...DEFAULT_ADAPTIVE_PERFORMANCE, auto: false });
    expect(resolution.renderScale).toBe(1);
    expect(saveSettings).toHaveBeenCalledWith({ ...DEFAULT_ADAPTIVE_PERFORMANCE, auto: false });
    feedGpuBound(budget, 30000, 20);
    expect(resolution.renderScale).toBe(1);
  });
});
