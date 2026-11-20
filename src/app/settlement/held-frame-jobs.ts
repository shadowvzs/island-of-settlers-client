/**
 * Work spread over frames at one tick boundary (snapshot capture and reload, D3): while jobs wait, each frame runs
 * one and the island does not tick, so every job sees the same state; rendering keeps running. The held frames'
 * time is simulated once the queue is empty, so the island keeps pace with real time.
 */
export const createHeldFrameJobs = (isHidden: () => boolean = () => document.hidden) => {
  const jobs: (() => void)[] = [];
  let heldSeconds = 0, holds = 0;
  return {
    /** Freezes every later frame at this boundary until the returned release runs (session handoff). */
    hold: () => {
      holds++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds = Math.max(0, holds - 1);
      };
    },
    /** True while a session handoff or queued jobs hold the island's ticks. */
    holding: () => holds > 0 || jobs.length > 0,
    /** Queues `job` for a coming frame; a hidden tab draws no frames, so it runs at once there. */
    queue: (job: () => void) => {
      if (isHidden()) job();
      else jobs.push(job);
    },
    /** Removes a job that has not run yet (its caller ran it without a frame). */
    cancel: (job: () => void) => {
      const index = jobs.indexOf(job);
      if (index >= 0) jobs.splice(index, 1);
    },
    /** A tab-resume catch-up already simulated this held time: do not simulate it again. */
    discardHeldTime: () => { heldSeconds = 0; },
    /** One frame of `seconds`: runs the next job (the time waits) or returns the seconds to simulate now. */
    frameSeconds: (seconds: number) => {
      if (holds > 0) {
        heldSeconds += seconds;
        return 0;
      }
      const job = jobs.shift();
      if (job) {
        heldSeconds += seconds;
        job();
        return 0;
      }
      const total = seconds + heldSeconds;
      heldSeconds = 0;
      return total;
    }
  };
};

export type HeldFrameJobs = ReturnType<typeof createHeldFrameJobs>;
