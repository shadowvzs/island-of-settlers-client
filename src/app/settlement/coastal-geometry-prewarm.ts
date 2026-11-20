interface PrewarmProgress { completed: number; total: number }
const SLICE_MS = 8;

/** Derived geometry only: service loading-screen paints without advancing a simulation tick. */
export const prewarmCoastalGeometry = async (
  work: Iterable<PrewarmProgress>, progress: (percent: number) => void
) => {
  let resumed = performance.now(), previous = -1;
  progress(0);
  for (const step of work) {
    const percent = Math.floor(step.completed / Math.max(1, step.total) * 100);
    if (percent !== previous) { progress(percent); previous = percent; }
    if (performance.now() - resumed < SLICE_MS) continue;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    resumed = performance.now();
  }
  progress(100);
};
