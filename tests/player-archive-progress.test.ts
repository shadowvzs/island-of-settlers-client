import { describe, expect, it, vi } from "vitest";

import type { ServerEconomy } from "../src/app/cloud/server-economy";
import { createArchivedPlayerProgress } from "../src/app/settlement/player-archive-progress";
import { createPlayerProgress } from "../src/shared/progression/player-progress";

describe("one-time archived player progress publication", () => {
  it("preserves server gems and announces/claims crossed levels once without another coin credit", () => {
    let progress = { ...createPlayerProgress(3), experience: 90, gems: 100 };
    const expected = structuredClone(progress), next = { ...progress, experience: 120, gems: 101 };
    const claimLevel = vi.fn(), onLevelUp = vi.fn();
    const bridge = createArchivedPlayerProgress({ current: () => progress, commit: next => { progress = next; },
      economy: { claimLevel } as unknown as ServerEconomy, onLevelUp });
    expect(bridge.prepareArchivedProgress(next).gems).toBe(100);
    expect(bridge.acceptArchivedProgress(expected, next)).toBe(true);
    expect(progress).toMatchObject({ experience: 120, gems: 100 });
    expect(claimLevel).toHaveBeenCalledExactlyOnceWith(2);
    expect(onLevelUp).toHaveBeenCalledOnce();
    expect(bridge.acceptArchivedProgress(expected, next)).toBe(false);
    expect(claimLevel).toHaveBeenCalledOnce();
  });

  it("rejects stale active production and keeps guest level gems from exact private replay", () => {
    let progress = createPlayerProgress(3);
    const bridge = createArchivedPlayerProgress({ current: () => progress, commit: next => { progress = next; } });
    const baseline = structuredClone(progress);
    progress = { ...progress, experience: 1 };
    expect(bridge.acceptArchivedProgress(baseline, { ...baseline, experience: 120, gems: 1 })).toBe(false);
    expect(progress.experience).toBe(1);
    const current = structuredClone(progress);
    expect(bridge.acceptArchivedProgress(current, { ...current, experience: 120, gems: 1 })).toBe(true);
    expect(progress).toMatchObject({ experience: 120, gems: 1 });
  });
});
