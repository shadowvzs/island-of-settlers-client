/**
 * Presentation-only leftover-time scheduler (R23). It runs resumable, non-authoritative slices
 * (probe/impostor bakes, KTX2 decode, cache warm-up) after the frame's simulation and render work.
 * The scheduler never touches simulation state; a slice that does not finish is picked up by the
 * next frame in priority order.
 */
export interface PresentationJob {
  /** Runs one resumable slice for at most `budgetMs`; true when the job is complete. */
  step: (budgetMs: number) => boolean;
}

export interface PresentationScheduler {
  /** Queues a job; higher priority runs first, equal priorities keep FIFO order. */
  enqueue: (job: PresentationJob, priority?: number) => { cancel: () => void };
  /** Runs queued jobs once each until `budgetMs` runs out; returns the number of slices started. */
  runBudget: (budgetMs: number) => number;
  /** Number of jobs still waiting (tests and diagnostics). */
  size: () => number;
}

interface Entry {
  cancelled: boolean;
  job: PresentationJob;
  order: number;
  priority: number;
}

/** A pure scheduler with an injectable clock, so the render loop and tests share one policy. */
export const createPresentationScheduler = (now: () => number = () => performance.now()): PresentationScheduler => {
  const entries: Entry[] = [];
  let nextOrder = 0;

  const remove = (entry: Entry) => {
    const index = entries.indexOf(entry);
    if (index >= 0) entries.splice(index, 1);
  };

  const enqueue = (job: PresentationJob, priority = 0) => {
    const entry: Entry = { cancelled: false, job, order: nextOrder++, priority };
    entries.push(entry);
    entries.sort((a, b) => b.priority - a.priority || a.order - b.order);
    return {
      cancel: () => {
        entry.cancelled = true;
        remove(entry);
      }
    };
  };

  const runBudget = (budgetMs: number) => {
    if (!Number.isFinite(budgetMs) || budgetMs <= 0 || entries.length === 0) return 0;
    const deadline = now() + budgetMs;
    let started = 0;
    // One slice per job per frame: a job that cannot finish inside its slice resumes next frame.
    for (const entry of entries.slice()) {
      if (entry.cancelled || !entries.includes(entry)) continue;
      const remaining = deadline - now();
      if (remaining <= 0) break;
      started += 1;
      if (entry.job.step(remaining)) remove(entry);
    }
    return started;
  };

  return { enqueue, runBudget, size: () => entries.length };
};
