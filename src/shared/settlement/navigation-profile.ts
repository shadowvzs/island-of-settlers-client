/**
 * Opt-in navigation attribution. Disabled unless a benchmark sets `globalThis.__navigationProfile`.
 * The counters are observation only: no timing or profiling state feeds back into simulation.
 */
export interface NavigationStageStats {
  count: number;
  totalMs: number;
  maxMs: number;
  /** Bounded per-call samples for p50/p95 reporting; older samples are dropped first. */
  samples: number[];
}
export interface NavigationProfileSnapshot {
  stages: Record<string, NavigationStageStats>;
  counters: Record<string, number>;
}

const MAX_SAMPLES = 20_000;
const stages = new Map<string, NavigationStageStats>();
const counters = new Map<string, number>();

export const navigationProfileEnabled = () =>
  (globalThis as { __navigationProfile?: boolean }).__navigationProfile === true;

const record = (name: string, ms: number) => {
  const stage = stages.get(name) ?? { count: 0, maxMs: 0, samples: [], totalMs: 0 };
  stage.count++;
  stage.totalMs += ms;
  stage.maxMs = Math.max(stage.maxMs, ms);
  stage.samples.push(ms);
  if (stage.samples.length > MAX_SAMPLES) stage.samples.shift();
  stages.set(name, stage);
};

/** Time one synchronous navigation/render-adjacent stage; the operation runs unchanged when disabled. */
export const profileNavigationStage = <T>(name: string, operation: () => T): T => {
  if (!navigationProfileEnabled()) return operation();
  const started = performance.now();
  try {
    return operation();
  } finally {
    record(name, performance.now() - started);
  }
};

/** Add a deterministic work counter (visits, candidates, queries) while profiling is enabled. */
export const countNavigation = (name: string, amount = 1) => {
  if (!navigationProfileEnabled()) return;
  counters.set(name, (counters.get(name) ?? 0) + amount);
};

export const clearNavigationProfile = () => {
  stages.clear();
  counters.clear();
};

export const readNavigationProfile = (): NavigationProfileSnapshot => ({
  stages: Object.fromEntries([...stages].map(([name, stage]) => [name, {
    count: stage.count, maxMs: stage.maxMs, samples: [...stage.samples], totalMs: stage.totalMs
  }])),
  counters: Object.fromEntries(counters)
});

const globals = globalThis as {
  __navigationProfileRead?: typeof readNavigationProfile;
  __navigationProfileClear?: typeof clearNavigationProfile;
};
globals.__navigationProfileRead = readNavigationProfile;
globals.__navigationProfileClear = clearNavigationProfile;
