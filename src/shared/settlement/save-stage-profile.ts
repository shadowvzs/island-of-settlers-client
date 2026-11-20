/** Opt-in save-path attribution. Disabled unless a benchmark sets `globalThis.__saveStageProfile`. */
export interface SaveStageSample {
  name: string;
  ms: number;
}

const samples: SaveStageSample[] = [];

/** Whether this realm records save-stage samples. Workers receive this through their request. */
export const saveStageProfilingEnabled = () =>
  (globalThis as { __saveStageProfile?: boolean }).__saveStageProfile === true;

/** Time one synchronous save stage; the operation runs unchanged when profiling is disabled. */
export const profileSaveStage = <T>(name: string, operation: () => T): T => {
  if (!saveStageProfilingEnabled()) return operation();
  const started = performance.now();
  try {
    return operation();
  } finally {
    samples.push({ name, ms: performance.now() - started });
  }
};

/** Async counterpart for compose, storage and encoding stages. */
export const profileSaveStageAsync = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
  if (!saveStageProfilingEnabled()) return operation();
  const started = performance.now();
  try {
    return await operation();
  } finally {
    samples.push({ name, ms: performance.now() - started });
  }
};

/** Clear samples between benchmark rounds. */
export const clearSaveStageProfile = () => {
  samples.length = 0;
};

/** Merge samples returned from a worker into the caller's timeline, preserving execution order. */
export const appendSaveStageSamples = (incoming: readonly SaveStageSample[]) => {
  for (const sample of incoming) samples.push({ name: sample.name, ms: sample.ms });
};

/** Snapshot of the recorded stages, in execution order. */
export const readSaveStageProfile = (): readonly SaveStageSample[] => samples.map(sample => ({ ...sample }));

// Debug-only bridge for the browser save-hitch benchmark. It is inert unless the benchmark
// enables `__saveStageProfile`; production code never calls these globals.
const profilingGlobals = globalThis as {
  __saveStageProfileRead?: typeof readSaveStageProfile;
  __saveStageProfileClear?: typeof clearSaveStageProfile;
};
profilingGlobals.__saveStageProfileRead = readSaveStageProfile;
profilingGlobals.__saveStageProfileClear = clearSaveStageProfile;
