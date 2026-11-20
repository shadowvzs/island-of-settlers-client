import { Skeleton } from "three";

import { activeFrameProfiler, currentFrameMark } from "../../render-common/frame-profiler";

/**
 * C01 character counters, on only while the R01 frame profiler runs (`?passes=1`): CPU per
 * crowd stage, `Skeleton.update` calls per render pass and the bone-texture bytes they upload.
 * Off, every probe is one boolean check and `Skeleton.prototype.update` is untouched.
 */
const STAGES = ["present", "pose", "ik", "props"] as const;
export type CharacterStage = typeof STAGES[number];

interface CharacterTotals {
  boneBytes: number;
  frames: number;
  skeletonUpdates: Map<string, number>;
  stageMs: Record<CharacterStage, number>;
}

export interface CharacterProfileReport {
  /** Mean bone-texture bytes uploaded per frame (one full boneMatrices upload per update). */
  boneBytes: number;
  frames: number;
  /** Mean `Skeleton.update` calls per frame by the render pass that triggered them. */
  skeletonUpdates: Record<string, number>;
  /** Mean CPU ms per frame of the crowd stages (pose: mixer + arm/stance IK appliers). */
  stageMs: Record<CharacterStage, number>;
}

const newTotals = (): CharacterTotals => ({ boneBytes: 0, frames: 0, skeletonUpdates: new Map(),
  stageMs: { ik: 0, pose: 0, present: 0, props: 0 } });

const windowTotals = newTotals();
const sessionTotals = newTotals();
let enabled = false;
let skeletonPatched = false;

const resetTotals = (totals: CharacterTotals) => {
  totals.boneBytes = 0;
  totals.frames = 0;
  totals.skeletonUpdates.clear();
  for (const stage of STAGES) totals.stageMs[stage] = 0;
};

const reportOf = (totals: CharacterTotals): CharacterProfileReport => {
  const frames = Math.max(1, totals.frames);
  const stageMs = { ik: 0, pose: 0, present: 0, props: 0 };
  for (const stage of STAGES) stageMs[stage] = totals.stageMs[stage] / frames;
  return { boneBytes: totals.boneBytes / frames, frames: totals.frames,
    skeletonUpdates: Object.fromEntries([...totals.skeletonUpdates].map(([pass, count]) => [pass, count / frames])),
    stageMs };
};

const countSkeletonUpdate = (skeleton: Skeleton) => {
  const pass = currentFrameMark() ?? "outside";
  const bytes = skeleton.boneTexture === null ? 0 : skeleton.boneMatrices?.byteLength ?? 0;
  for (const totals of [windowTotals, sessionTotals]) {
    totals.skeletonUpdates.set(pass, (totals.skeletonUpdates.get(pass) ?? 0) + 1);
    totals.boneBytes += bytes;
  }
};

const patchSkeletonUpdate = () => {
  if (skeletonPatched) return;
  skeletonPatched = true;
  const update = Skeleton.prototype.update;
  Skeleton.prototype.update = function (this: Skeleton) {
    if (enabled) countSkeletonUpdate(this);
    update.call(this);
  };
};

/** The start of a stage: now, or 0 when profiling is off. */
export const characterClock = () => (enabled ? performance.now() : 0);

/** Adds the stage since `startedAt`; returns the new start for the next stage (0 when off). */
export const addCharacterStage = (stage: CharacterStage, startedAt: number) => {
  if (!enabled) return 0;
  const now = performance.now();
  windowTotals.stageMs[stage] += now - startedAt;
  sessionTotals.stageMs[stage] += now - startedAt;
  return now;
};

/** Called by the renderer at the start of every render: follows the frame profiler's state. */
export const beginCharacterProfileFrame = () => {
  enabled = activeFrameProfiler() !== null;
  if (!enabled) return;
  patchSkeletonUpdate();
  windowTotals.frames++;
  sessionTotals.frames++;
};

export const characterProfileEnabled = () => enabled;

/** Means since the last roll (the stats overlay rolls every 0.5 s). */
export const rollCharacterWindow = () => {
  const report = reportOf(windowTotals);
  resetTotals(windowTotals);
  return report;
};

const session = {
  report: () => reportOf(sessionTotals),
  reset: () => resetTotals(sessionTotals)
};
(globalThis as { __characterProfile?: typeof session }).__characterProfile = session;

const formatMs = (value: number) => value.toFixed(2);

/** Stats-overlay lines of one window (`rollCharacterWindow`) and the mounts drawn now. */
export const characterProfileDetails = (report: CharacterProfileReport, cavalry: { far: number; near: number }) => ({
  characterBoneKiB: Math.round(report.boneBytes / 1024),
  characterSkeletonUpdates: Object.entries(report.skeletonUpdates)
    .map(([pass, count]) => `${pass} ${count.toFixed(0)}`).join(", ") || "0",
  characterStageMs: STAGES.map(stage => `${stage} ${formatMs(report.stageMs[stage])}`).join(" / "),
  cavalryNearFar: `${cavalry.near}/${cavalry.far}`
});
