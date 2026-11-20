import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SEASON_SETTINGS } from "../../island-of-settlers-shared/src/appearance/season-calendar";
import { createExternalStore } from "../src/app/components/ui-store";
import { bindSeasonalRuntime } from "../src/app/settings/seasonal-appearance/runtime-binding";
import {
  getSeasonRuntimeState,
  type SeasonalAppearanceSnapshot,
  type SeasonRuntimeState
} from "../src/app/settings/seasonal-appearance/store";

const fixture = () => {
  const store = createExternalStore<SeasonalAppearanceSnapshot>({ clockOffset: 0, globalWinter: false,
    ignoreGlobalWinter: false, online: true, season: { ...DEFAULT_SEASON_SETTINGS }, seasonSnowActive: false,
    winterActive: false });
  let applied: SeasonRuntimeState = {}, busy = false;
  const refresh = vi.fn(async () => { applied = getSeasonRuntimeState(store.getSnapshot()); return true; });
  const onFailure = vi.fn();
  const dispose = bindSeasonalRuntime({ applied: () => applied, busy: () => busy, onFailure, refresh, store });
  const winter = (active: boolean) => store.set({ ...store.getSnapshot(), globalWinter: active, winterActive: active });
  return { dispose, onFailure, refresh, store, winter,
    setApplied: (value: boolean) => { applied = { visualWinter: value }; },
    setBusy: (value: boolean) => { busy = value; } };
};

afterEach(() => { vi.useRealTimers(); });

describe("cosmetic season runtime refresh", () => {
  it("leaves an unchanged season alone and refreshes only an effective appearance change", async () => {
    const scene = fixture();
    expect(scene.refresh).not.toHaveBeenCalled();
    scene.winter(true);
    await Promise.resolve();
    expect(scene.refresh).toHaveBeenCalledTimes(1);
    scene.store.set({ ...scene.store.getSnapshot(), online: false });
    expect(scene.refresh).toHaveBeenCalledTimes(1);
    scene.dispose();
  });

  it("waits for another island transition and coalesces intermediate settings", async () => {
    vi.useFakeTimers();
    const scene = fixture();
    scene.setBusy(true);
    scene.winter(true);
    scene.winter(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(scene.refresh).not.toHaveBeenCalled();
    scene.winter(true);
    scene.setBusy(false);
    await vi.advanceTimersByTimeAsync(250);
    expect(scene.refresh).toHaveBeenCalledTimes(1);
    scene.dispose();
  });

  it("applies the latest preference after a pending refresh completes", async () => {
    vi.useFakeTimers();
    const scene = fixture();
    let finish!: (value: boolean) => void;
    scene.refresh.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    scene.winter(true);
    scene.winter(false);
    scene.setApplied(true);
    finish(true);
    await vi.advanceTimersByTimeAsync(250);
    expect(scene.refresh).toHaveBeenCalledTimes(2);
    scene.dispose();
  });

  it("keeps a failed refresh from entering an automatic failure loop", async () => {
    vi.useFakeTimers();
    const scene = fixture();
    scene.refresh.mockResolvedValue(false);
    scene.winter(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(scene.refresh).toHaveBeenCalledTimes(1);
    expect(scene.onFailure).toHaveBeenCalledTimes(1);
    scene.dispose();
  });

  it("cancels deferred refreshes on page disposal", async () => {
    vi.useFakeTimers();
    const scene = fixture();
    scene.setBusy(true);
    scene.winter(true);
    scene.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    scene.winter(false);
    scene.winter(true);
    expect(scene.refresh).not.toHaveBeenCalled();
  });

  it("rebuilds once when the GPU season snow is armed, before the winter look switches", async () => {
    const scene = fixture();
    scene.store.set({ ...scene.store.getSnapshot(), seasonSnowActive: true });
    await Promise.resolve();
    expect(scene.refresh).toHaveBeenCalledTimes(1);
    scene.store.set({ ...scene.store.getSnapshot(), online: false });
    await Promise.resolve();
    expect(scene.refresh).toHaveBeenCalledTimes(1);
    scene.dispose();
  });
});
