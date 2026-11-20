import type { createBugReplayRecorder } from "../../shared/settlement/bug-replay";
import type { createReplaySceneJournal } from "../../shared/settlement/replay-scene";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import { snapshotTrafficWork } from "../../shared/settlement/settlement-traffic-counters";
import { createHeldFrameJobs, type HeldFrameJobs } from "./held-frame-jobs";
import { settlementFrameDelta } from "./settlement-frame-budget";

interface SettlementFrameStepOptions {
  /** Right after every update (the simulation's tick boundary); `simulated` when game time advanced. */
  afterTick?: (simulated: boolean) => void;
  bugReplay: ReturnType<typeof createBugReplayRecorder>;
  /** The archipelago session advances with the island. */
  getIslandTravel?: () => { update: (seconds: number) => void } | undefined;
  heldJobs?: HeldFrameJobs;
  replayScene: ReturnType<typeof createReplaySceneJournal>;
  simulation: SettlementSimulation;
}

/**
 * One frame of the island's simulation: held frames (save capture and snapshot reload) run their job instead of
 * ticking; otherwise the island, its bug replay journal and the archipelago advance by the frame's seconds.
 */
export const createSettlementFrameStep = (options: SettlementFrameStepOptions) => {
  const { bugReplay, replayScene, simulation } = options;
  const heldJobs = options.heldJobs ?? createHeldFrameJobs();
  const simulate = (seconds: number) => {
    const recording = bugReplay.recording();
    const started = recording ? performance.now() : 0;
    const before = recording ? snapshotTrafficWork() : undefined;
    if (seconds > 0) replayScene.beforeUpdate();
    simulation.update(seconds);
    if (before) {
      const after = snapshotTrafficWork();
      for (const key of Object.keys(after) as (keyof typeof after)[]) after[key] -= before[key];
      bugReplay.advance(seconds, performance.now() - started, after);
    } else bugReplay.advance(seconds);
    options.getIslandTravel?.()?.update(seconds);
    options.afterTick?.(seconds > 0);
  };
  /** A render frame: the frame budget caps a delayed frame; long absences use the tab-resume path. */
  const step: ((dt: number) => void) & { advance: (seconds: number) => void } =
    dt => simulate(settlementFrameDelta(heldJobs.frameSeconds(dt)));
  /** An explicit bounded catch-up step (tab resume): it bypasses only the render frame's budget. */
  step.advance = simulate;
  return step;
};
