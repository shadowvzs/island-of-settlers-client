import { describe, expect, it, vi } from "vitest";

import type { FellingState } from "../src/render-common/felling/tree-felling";
import type { FrameState } from "../src/render-common/renderer-contract";
import { snapshotAtmosphereFrame } from "../tools/bench/atmosphere-frame-snapshot";

describe("atmosphere benchmark frame snapshot", () => {
  it("pins arrays and callback data without retaining live simulation reads", () => {
    const state: FellingState = {
      chop: [1, .3, .5, 0], phase: "falling", showStump: false, showTree: true
    };
    const standing: FellingState = {
      chop: [0, 0, 0, 0], phase: "standing", showStump: false, showTree: true
    };
    const growing = [{ id: 7, progress: .4, stage: 2 }];
    const grown = [8];
    let revision = 4;
    const felledIds = vi.fn(() => [5].values());
    const getState = vi.fn((id: number) => id === 5 ? state : standing);
    const growthReads = vi.fn(() => growing.values());
    const revisionRead = vi.fn(() => revision);
    const live = {
      birds: { count: 1, x: new Float32Array([12]) },
      camera: { centerX: 12, zoom: 1 },
      felling: { felledIds, getState, leaves: { alpha: new Float32Array([.8]), capacity: 1 } },
      growth: {
        growing: growthReads, grownIds: () => grown.values(),
        isGrown: () => false, isGrowing: () => false, revision: revisionRead
      },
      time: 30
    } as unknown as FrameState;
    const frozen = snapshotAtmosphereFrame(live);
    const readsAtCapture = [felledIds.mock.calls.length, getState.mock.calls.length,
      growthReads.mock.calls.length, revisionRead.mock.calls.length];
    live.birds.x[0] = 99;
    live.camera.centerX = 99;
    live.felling.leaves.alpha[0] = 0;
    state.chop[0] = 0;
    growing[0]!.progress = .9;
    grown.push(9);
    revision = 8;
    expect(frozen.birds.x[0]).toBe(12);
    expect(frozen.camera.centerX).toBe(12);
    expect(frozen.felling.leaves.alpha[0]).toBeCloseTo(.8);
    expect([...frozen.felling.felledIds()]).toEqual([5]);
    expect(frozen.felling.getState(5).chop[0]).toBe(1);
    expect(frozen.felling.getState(20).phase).toBe("standing");
    expect([...frozen.growth.growing()][0]!.progress).toBe(.4);
    expect([...frozen.growth.grownIds()]).toEqual([8]);
    expect(frozen.growth.isGrown(8)).toBe(true);
    expect(frozen.growth.isGrown(9)).toBe(false);
    expect(frozen.growth.isGrowing(7)).toBe(true);
    expect(frozen.growth.revision()).toBe(4);
    expect([felledIds.mock.calls.length, getState.mock.calls.length,
      growthReads.mock.calls.length, revisionRead.mock.calls.length]).toEqual(readsAtCapture);
    expect([...snapshotAtmosphereFrame(frozen).growth.grownIds()]).toEqual([8]);
  });
});
