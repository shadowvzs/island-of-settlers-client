import { beforeAll, describe, expect, it } from "vitest";

import { toSaveSnapshot } from "../src/app/save-store/save-snapshot";
import { verifyCommandLogs } from "../src/app/settlement/command-log-verify";
import { createHeadlessIsland } from "../src/app/settlement/headless-replay";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRecoveryAccountFixture } from "../tools/bench/commander-recovery-account-fixture";

let baseline: GameSaveV1;
beforeAll(async () => { baseline = (await createRecoveryAccountFixture()).game; });

const playFrames = async (chained = false) => {
  const base = structuredClone(baseline);
  base.settlement.accumulator = .041;
  const live = await createHeadlessIsland(base), { simulation } = live;
  const recorder = createCommandLogRecorder(simulation, { sourceVersion: "frame-remainder" });
  recorder.open();
  for (let frame = 0; frame < 143; frame++) simulation.update([.016, .017, .016][frame % 3]!);
  const first = recorder.close("home")!;
  first.baseRevision = 1;
  const intervals = [first];
  if (chained) {
    expect(simulation.reloadSnapshot(simulation.saveState(), true).ok).toBe(true);
    recorder.open();
    for (let frame = 0; frame < 67; frame++) simulation.update([.018, .013][frame % 2]!);
    intervals.push(recorder.close("home")!);
  }
  recorder.dispose();
  return { base: toSaveSnapshot(base), end: toSaveSnapshot(await live.save()), intervals };
};

describe("exact command-log replay of partial render frames", () => {
  it.each([false, true])("preserves full endpoint hashes and nonzero remainder through chained=%s reloads", async chained => {
    const played = await playFrames(chained);
    expect(played.intervals[0]!.endAccumulator).not.toBe(.041);
    expect(await verifyCommandLogs(played)).toMatchObject({ status: "verified" });
  });

  it("rejects forged endpoint remainder and actor HP with the full snapshot hash", async () => {
    const played = await playFrames();
    const intervals = structuredClone(played.intervals);
    intervals[0]!.endAccumulator = .012;
    expect(await verifyCommandLogs({ ...played, intervals })).toMatchObject({ status: "mismatch",
      mismatch: { kind: "snapshot" } });
    const end = structuredClone(played.end);
    const saved = end.islands[0]!.save.data as unknown as GameSaveV1;
    saved.settlement.military!.soldiers[0]!.combat!.hp++;
    expect(await verifyCommandLogs({ ...played, end })).toMatchObject({ status: "mismatch",
      mismatch: { kind: "snapshot" } });
  });

  it("strictly refuses missing, coercible, nonfinite, negative and whole-tick metadata", async () => {
    const played = await playFrames();
    for (const value of [undefined, null, "0", NaN, Infinity, -.0001, .05, 1]) {
      const interval = { ...played.intervals[0]!, endAccumulator: value };
      const island = await createHeadlessIsland(baseline);
      const before = island.simulation.saveState();
      expect(replayCommandLog(island.simulation, interval as never)).toMatchObject({ ok: false,
        mismatch: { kind: "invalid", reason: "Invalid frame accumulator" } });
      expect(island.simulation.saveState()).toEqual(before);
    }
  });

  it("restores only sub-tick metadata at the exact endpoint without clock, tick, actor or checksum effects", async () => {
    const island = await createHeadlessIsland(baseline), { simulation } = island;
    const before = simulation.saveState(), checksum = simulation.counterChecksum(), now = simulation.gameNow();
    let ticks = 0;
    const unsubscribe = simulation.observeTicks(() => { ticks++; });
    expect(simulation.restoreReplayAccumulator(.049, simulation.gameTick() + 1)).toBe(false);
    for (const value of [undefined, "0", null, NaN, Infinity, -1, .05])
      expect(simulation.restoreReplayAccumulator(value, simulation.gameTick())).toBe(false);
    expect(simulation.restoreReplayAccumulator(.049, simulation.gameTick())).toBe(true);
    expect(simulation.saveState()).toEqual({ ...before, accumulator: .049 });
    expect(simulation.gameNow()).toBe(now);
    expect(simulation.gameTick()).toBe(before.gameTick);
    expect(simulation.counterChecksum()).toBe(checksum);
    expect(ticks).toBe(0);
    unsubscribe();
  });
});
