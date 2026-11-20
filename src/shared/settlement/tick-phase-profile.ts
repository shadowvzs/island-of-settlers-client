/**
 * A02 tick-phase attribution. Off unless a bench installs a recorder: then each mark closes the
 * previous phase and opens the next (sequential, never nested). Marks read and write no
 * simulation state, so the state hash is identical with and without a recorder. The clock is
 * injected by the bench; the simulation itself never reads wall time.
 */
export interface TickPhaseRecorder {
  endTick: () => void;
  mark: (phase: string, detail?: string) => void;
}

let recorder: TickPhaseRecorder | null = null;

/** `detail` splits a phase further (the actor loop passes the actor's occupation). */
export const markTickPhase = (phase: string, detail?: string) => {
  if (recorder !== null) recorder.mark(phase, detail);
};

export const endTickPhases = () => {
  if (recorder !== null) recorder.endTick();
};

export const setTickPhaseRecorder = (next: TickPhaseRecorder | null) => {
  recorder = next;
};

export interface TickPhaseStats {
  calls: number;
  maxMs: number;
  totalMs: number;
}

export interface TickPhaseReport {
  phases: Record<string, TickPhaseStats>;
  ticks: number;
  totalMs: number;
}

/** Wall ms, calls and the longest single span per phase key (`phase` or `phase:detail`). */
export const createTickPhaseTotals = (now: () => number) => {
  const phases = new Map<string, TickPhaseStats>();
  const detailKeys = new Map<string, Map<string, string>>();
  let open: TickPhaseStats | null = null;
  let openedAt = 0;
  let ticks = 0;
  let totalMs = 0;

  const keyOf = (phase: string, detail: string | undefined) => {
    if (detail === undefined) return phase;
    let keys = detailKeys.get(phase);
    if (!keys) detailKeys.set(phase, keys = new Map());
    let key = keys.get(detail);
    if (key === undefined) keys.set(detail, key = `${phase}:${detail}`);
    return key;
  };

  const close = (at: number) => {
    if (open === null) return;
    const elapsed = at - openedAt;
    open.calls++;
    open.totalMs += elapsed;
    if (elapsed > open.maxMs) open.maxMs = elapsed;
    totalMs += elapsed;
    open = null;
  };

  const recorder: TickPhaseRecorder = {
    endTick: () => {
      close(now());
      ticks++;
    },
    mark: (phase, detail) => {
      const at = now();
      close(at);
      const key = keyOf(phase, detail);
      let stats = phases.get(key);
      if (!stats) phases.set(key, stats = { calls: 0, maxMs: 0, totalMs: 0 });
      open = stats;
      openedAt = at;
    }
  };

  const report = (): TickPhaseReport => ({
    phases: Object.fromEntries([...phases].map(([key, stats]) => [key, { ...stats }])),
    ticks,
    totalMs
  });

  const reset = () => {
    phases.clear();
    open = null;
    ticks = 0;
    totalMs = 0;
  };

  return { recorder, report, reset };
};

/** Sums of `phase:detail` keys under their phase and of dotted keys under their prefix. */
export const groupTickPhases = (phases: Record<string, TickPhaseStats>, separator: ":" | ".") => {
  const groups: Record<string, TickPhaseStats> = {};
  for (const [key, stats] of Object.entries(phases)) {
    const index = key.indexOf(separator);
    const group = index < 0 ? key : key.slice(0, index);
    const total = (groups[group] ??= { calls: 0, maxMs: 0, totalMs: 0 });
    total.calls += stats.calls;
    total.totalMs += stats.totalMs;
    total.maxMs = Math.max(total.maxMs, stats.maxMs);
  }
  return groups;
};
