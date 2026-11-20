import type { SettlementSimulation } from "./settlement-simulation";
import type { TrafficWorkCounters } from "./settlement-traffic-counters";

const REPLAY_TIME_BINS = [1, 4, 8, 16.67, 33.34, 66.67, 100] as const;
export const createReplayDiagnostics = () => {
  let steps = 0, totalMs = 0, maximumMs = 0;
  const histogram = Array<number>(REPLAY_TIME_BINS.length + 1).fill(0);
  const slow: { at: number; milliseconds: number; groundVisits: number }[] = [];
  const commands: Record<string, { count: number; totalMs: number; maximumMs: number }> = {};
  const navigation: { at: number; blocked: number; actors: unknown[]; military: unknown; repairs: unknown }[] = [];
  const work: Partial<TrafficWorkCounters> = {};
  return {
    step: (at: number, milliseconds: number, delta?: Partial<TrafficWorkCounters>) => {
      if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
      steps++; totalMs += milliseconds; maximumMs = Math.max(maximumMs, milliseconds);
      const bin = REPLAY_TIME_BINS.findIndex(limit => milliseconds <= limit);
      histogram[bin < 0 ? histogram.length - 1 : bin]!++;
      for (const key of Object.keys(delta ?? {}) as (keyof TrafficWorkCounters)[])
        work[key] = (work[key] ?? 0) + Math.max(0, delta![key] ?? 0);
      if (milliseconds <= 16.67) return;
      slow.push({ at, milliseconds, groundVisits: delta?.groundVisits ?? 0 });
      if (slow.length > 32) slow.shift();
    },
    navigation: (at: number, sample: ReturnType<SettlementSimulation["navigationDiagnostics"]>) => {
      const blocked = sample.actors.filter(actor => actor.blocked || actor.elapsed > 1 || actor.queueWait > 1);
      navigation.push({ at, blocked: blocked.length,
        actors: blocked.sort((a, b) => b.elapsed - a.elapsed).slice(0, 16),
        military: sample.military, repairs: sample.repairs });
      if (navigation.length > 32) navigation.shift();
    },
    command: (name: string, milliseconds: number) => {
      const entry = commands[name] ??= { count: 0, totalMs: 0, maximumMs: 0 };
      entry.count++; entry.totalMs += milliseconds; entry.maximumMs = Math.max(entry.maximumMs, milliseconds);
    },
    snapshot: () => structuredClone({ steps, totalMs, maximumMs, histogram, limitsMs: REPLAY_TIME_BINS,
      slow, commands, work, navigation })
  };
};
export type ReplayDiagnostics = ReturnType<ReturnType<typeof createReplayDiagnostics>["snapshot"]>;
