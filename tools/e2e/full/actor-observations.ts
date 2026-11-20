import type { SettlementActor } from "../../../src/shared/settlement/settlement-types";

export type LegitimateWait = "paused" | "missing-input" | "missing-tool" | "full-output" |
  "no-target" | "recruitment" | "off-map";
export interface ActorContext {
  wait?: LegitimateWait;
  cycleSeconds?: number;
  expectedTravelAndQueueSeconds?: number;
  /** Independently observed transfer/work/queue completion counter, never wall-clock animation time. */
  progress?: number;
}
export const sampleActors = (
  actors: readonly SettlementActor[], time: number, context: Readonly<Record<number, ActorContext>> = {}
) => actors.map(actor => ({
  uid: actor.uid, time, x: actor.x, z: actor.z, role: actor.job, phase: actor.phase,
  action: actor.action, building: actor.building, ware: actor.ware, pathIndex: actor.pathIndex,
  target: actor.path.at(-1) ?? null, queueKind: actor.queueKind ?? null,
  queueWait: actor.queueWait ?? 0, transfer: actor.wareTransfer?.progress ?? null,
  timer: actor.timer, ...context[actor.uid]
}));
export type ActorSample = ReturnType<typeof sampleActors>[number];

/** Suspicion requires review: static positions alone never establish a traffic deadlock. */
export const createProgressTracker = (options: { minimumSeconds?: number; maximumActors?: number } = {}) => {
  const previous = new Map<number, { sample: ActorSample; lastProgress: number }>();
  const minimum = options.minimumSeconds ?? 60;
  const maximum = options.maximumActors ?? 4096;
  return (samples: readonly ActorSample[]) => {
    const seen = new Set<number>();
    const observations: Array<{ uid: number; classification: string; age: number; deadline: number }> = [];
    for (const sample of samples) {
      seen.add(sample.uid);
      const old = previous.get(sample.uid);
      const changed = !old || sample.time < old.sample.time ||
        Math.hypot(sample.x - old.sample.x, sample.z - old.sample.z) > .05 ||
        sample.phase !== old.sample.phase || sample.ware !== old.sample.ware ||
        sample.pathIndex !== old.sample.pathIndex || sample.progress !== old.sample.progress ||
        sample.transfer !== old.sample.transfer || sample.queueKind !== old.sample.queueKind ||
        (sample.timer < old.sample.timer && ["work", "chop", "plant", "fish_wait", "fish_reel"]
          .includes(sample.action));
      const lastProgress = changed || sample.wait ? sample.time : old!.lastProgress;
      const age = Math.max(0, sample.time - lastProgress);
      const deadline = Math.max(minimum, 3 * (sample.cycleSeconds ?? 0) +
        (sample.expectedTravelAndQueueSeconds ?? 0));
      let classification = age >= deadline ? "suspected-stall" : "observing";
      if (sample.wait) classification = `waiting:${sample.wait}`;
      observations.push({ uid: sample.uid, age, deadline, classification });
      if (previous.has(sample.uid) || previous.size < maximum) previous.set(sample.uid, { sample, lastProgress });
    }
    for (const uid of previous.keys()) if (!seen.has(uid)) previous.delete(uid);
    return { observations, dropped: samples.filter(sample => !previous.has(sample.uid)).length,
      suspected: observations.filter(row => row.classification === "suspected-stall") };
  };
};
