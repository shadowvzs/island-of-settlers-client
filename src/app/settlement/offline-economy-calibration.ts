import { TICK_HZ } from "../../../../island-of-settlers-shared/src/time/constants";

interface CycleWaits { atOutputs: readonly number[]; atEnd: number; atInitialEnd?: number }

export const createEconomyCycleObservation = () => ({
  ticks: [] as number[], outputs: new Set<string>(), waitAtOutputs: [] as number[],
  inputWaitSeconds: 0, outputWaitSeconds: 0, initialWaitSeconds: 0
});

/** Preserve native movement/contention; remove only stock waits modeled separately by the event ledger. */
export const calibratedEconomyCycle = (
  ticks: readonly number[], endTick: number, workSeconds: number, waits?: CycleWaits
) => {
  if (ticks.length < 2) return undefined;
  if (waits && (waits.atOutputs.length !== ticks.length || !Number.isFinite(waits.atEnd) ||
    waits.atOutputs.some((value, index) => !Number.isFinite(value) || value < 0 ||
      value > waits.atEnd || (index > 0 && value < waits.atOutputs[index - 1]!)))) return undefined;
  const gaps = ticks.slice(1).map((tick, index) => (tick - ticks[index]!) * .05 -
    (waits ? waits.atOutputs[index + 1]! - waits.atOutputs[index]! : 0));
  const measured = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  if (!(measured > 0) || gaps.some(gap => gap <= 0)) return undefined;
  const trailing = (endTick - ticks.at(-1)!) * .05 - (waits ? waits.atEnd - waits.atOutputs.at(-1)! : 0);
  if (trailing < -1e-6 || trailing > 2 * measured) return undefined;
  // A long enough span can include a congested trip. With only one or two intervals, retain the
  // strict jitter guard: a short stocked burst is not reliable sustained throughput.
  if (gaps.length < 3 && Math.max(...gaps) > 2 * Math.min(...gaps)) return undefined;
  return Math.max(workSeconds, measured);
};

/** Extra native warmup fills missing profiles without replacing an established short-window cycle. */
export const extendedCalibratedEconomyCycle = (
  ticks: readonly number[], startTick: number, endTick: number, workSeconds: number, waits?: CycleWaits
) => {
  const initialEnd = Math.min(endTick, startTick + 120 * TICK_HZ);
  const initial = ticks.filter(tick => tick <= initialEnd);
  const initialWaits = waits && { atOutputs: waits.atOutputs.slice(0, initial.length),
    atEnd: waits.atInitialEnd ?? waits.atEnd };
  return calibratedEconomyCycle(initial, initialEnd, workSeconds, initialWaits) ??
    calibratedEconomyCycle(ticks, endTick, workSeconds, waits);
};
